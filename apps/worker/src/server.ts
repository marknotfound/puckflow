import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'

import * as Sentry from '@sentry/node'
import { closeDatabase, createDatabase } from '@puckflow/db'
import { sql } from 'drizzle-orm'
import pino from 'pino'

import { loadWorkerConfig } from './config.js'
import { createJobHandlers } from './handlers.js'
import {
  safeErrorIdentity,
  sanitizedWorkerException,
  workerShutdownError,
} from './errors.js'
import { runWorkerIteration, type WorkerLogger } from './runner.js'

export interface WorkerSignals {
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown
  removeListener(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown
}

export type WorkerProcessDependencies = {
  signals: WorkerSignals
  runIteration(signal: AbortSignal): Promise<unknown>
  sleep(signal: AbortSignal): Promise<void>
  closeHealthServer(): Promise<void>
  closeDatabase(): Promise<void>
  flushSentry(timeoutMs: number): Promise<unknown>
  forceExit(code: number): void
  shutdownTimeoutMs: number
  logger: WorkerLogger
}

export function createWorkerHealthServer(database: {
  execute(query: unknown): Promise<unknown>
}): Server {
  return createServer((request, response) => {
    void handleHealthRequest(database, request.method, request.url, response)
  })
}

async function handleHealthRequest(
  database: { execute(query: unknown): Promise<unknown> },
  method: string | undefined,
  url: string | undefined,
  response: import('node:http').ServerResponse,
): Promise<void> {
  response.setHeader('content-type', 'application/json; charset=utf-8')
  if (method === 'GET' && url === '/health/live') {
    response.writeHead(200).end(JSON.stringify({ status: 'ok' }))
    return
  }
  if (method === 'GET' && url === '/health/ready') {
    try {
      await database.execute(sql`select 1`)
      response.writeHead(200).end(JSON.stringify({ status: 'ok' }))
    } catch {
      response.writeHead(503).end(JSON.stringify({ status: 'unavailable' }))
    }
    return
  }
  response.writeHead(404).end(JSON.stringify({ status: 'not_found' }))
}

export async function runWorkerProcess(
  dependencies: WorkerProcessDependencies,
): Promise<void> {
  let stopping = false
  let currentOperation: Promise<unknown> | undefined
  let forceExit = false
  const shutdownController = new AbortController()
  let resolveShutdown: () => void = () => undefined
  const shutdownRequested = new Promise<void>((resolve) => {
    resolveShutdown = resolve
  })
  const requestShutdown = (signal: 'SIGTERM' | 'SIGINT') => {
    if (stopping) return
    stopping = true
    dependencies.logger.info({ signal }, 'worker shutting down')
    shutdownController.abort()
    resolveShutdown()
  }
  const onSigterm = () => requestShutdown('SIGTERM')
  const onSigint = () => requestShutdown('SIGINT')
  dependencies.signals.once('SIGTERM', onSigterm)
  dependencies.signals.once('SIGINT', onSigint)

  try {
    while (!stopping) {
      currentOperation = dependencies.runIteration(shutdownController.signal)
      const outcome = await Promise.race([
        settle(currentOperation).then(() => 'iteration' as const),
        shutdownRequested.then(() => 'shutdown' as const),
      ])
      if (outcome === 'shutdown') {
        forceExit = !(await settlesWithin(
          currentOperation,
          dependencies.shutdownTimeoutMs,
        ))
        break
      }
      await currentOperation
      currentOperation = undefined
      if (stopping) break

      currentOperation = dependencies.sleep(shutdownController.signal)
      const sleepOutcome = await Promise.race([
        settle(currentOperation).then(() => 'sleep' as const),
        shutdownRequested.then(() => 'shutdown' as const),
      ])
      if (sleepOutcome === 'shutdown') {
        forceExit = !(await settlesWithin(
          currentOperation,
          dependencies.shutdownTimeoutMs,
        ))
        break
      }
      await currentOperation
      currentOperation = undefined
    }
  } finally {
    dependencies.signals.removeListener('SIGTERM', onSigterm)
    dependencies.signals.removeListener('SIGINT', onSigint)
    try {
      await dependencies.closeHealthServer()
    } finally {
      try {
        await dependencies.closeDatabase()
      } finally {
        await dependencies.flushSentry(2_000)
      }
    }
  }
  if (forceExit) dependencies.forceExit(1)
}

async function main(): Promise<void> {
  const config = loadWorkerConfig()
  Sentry.init({
    dsn: config.sentryDsn,
    enabled: Boolean(config.sentryDsn),
    environment: config.sentryEnvironment,
    release: config.sentryRelease,
    sendDefaultPii: false,
  })
  const logger = createLogger({
    level: config.logLevel,
    environment: config.sentryEnvironment,
    release: config.sentryRelease,
  })
  const database = createDatabase(config.databaseUrl)
  const healthServer = createWorkerHealthServer(database)
  await listen(healthServer, config.healthPort)
  logger.info({ port: config.healthPort }, 'worker health server listening')
  const handlers = createJobHandlers(logger)

  await runWorkerProcess({
    signals: process,
    runIteration: async (signal) => {
      try {
        const result = await runWorkerIteration({
          database,
          workerId: config.workerId,
          now: new Date(),
          batchSize: config.batchSize,
          handlers,
          logger,
          sentry: {
            captureException(error, context) {
              Sentry.withScope((scope) => {
                scope.setTag('jobId', context.jobId)
                scope.setTag('category', context.category)
                Sentry.captureException(error)
              })
            },
          },
          signal,
        })
        logger.info(result, 'worker iteration completed')
      } catch (error) {
        const identity = safeErrorIdentity(error)
        logger.error(identity, 'worker iteration failed')
        Sentry.captureException(sanitizedWorkerException(error))
      }
    },
    sleep: (signal) => abortableDelay(config.pollIntervalMs, signal),
    closeHealthServer: () => closeServer(healthServer),
    closeDatabase: () => closeDatabase(database),
    flushSentry: (timeoutMs) => Sentry.flush(timeoutMs),
    forceExit: (code) => process.exit(code),
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    logger,
  })
}

function createLogger(options: {
  level: string
  environment: string
  release: string
}) {
  return pino({
    level: options.level,
    base: {
      service: 'worker',
      environment: options.environment,
      release: options.release,
    },
    redact: {
      paths: ['*.databaseUrl', '*.token', '*.secret', '*.password'],
      censor: '[Redacted]',
    },
  })
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

export function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(workerShutdownError())
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      reject(workerShutdownError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function settlesWithin(
  operation: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs)
    void settle(operation).then(() => {
      clearTimeout(timeout)
      resolve(true)
    })
  })
}

function settle(operation: Promise<unknown>): Promise<void> {
  return operation.then(
    () => undefined,
    () => undefined,
  )
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1]
  return Boolean(
    entrypoint && import.meta.url === pathToFileURL(entrypoint).href,
  )
}

if (isMainModule()) {
  void main()
    .then(() => {
      process.exitCode = 0
    })
    .catch(async () => {
      process.stderr.write('Worker failed to start\n')
      await Sentry.flush(2_000)
      process.exitCode = 1
    })
}
