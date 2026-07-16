import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'

import * as Sentry from '@sentry/node'
import { closeDatabase, createDatabase } from '@puckflow/db'
import { sql } from 'drizzle-orm'
import pino from 'pino'

import { loadWorkerConfig } from './config.js'
import { createJobHandlers } from './handlers.js'
import { runWorkerIteration, type WorkerLogger } from './runner.js'

export interface WorkerSignals {
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown
  removeListener(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown
}

export type WorkerProcessDependencies = {
  signals: WorkerSignals
  runIteration(): Promise<unknown>
  sleep(): Promise<void>
  closeHealthServer(): Promise<void>
  closeDatabase(): Promise<void>
  flushSentry(timeoutMs: number): Promise<unknown>
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
  let currentIteration: Promise<unknown> | undefined
  let resolveShutdown: () => void = () => undefined
  const shutdownRequested = new Promise<void>((resolve) => {
    resolveShutdown = resolve
  })
  const requestShutdown = (signal: 'SIGTERM' | 'SIGINT') => {
    if (stopping) return
    stopping = true
    dependencies.logger.info({ signal }, 'worker shutting down')
    resolveShutdown()
  }
  const onSigterm = () => requestShutdown('SIGTERM')
  const onSigint = () => requestShutdown('SIGINT')
  dependencies.signals.once('SIGTERM', onSigterm)
  dependencies.signals.once('SIGINT', onSigint)

  try {
    while (!stopping) {
      currentIteration = dependencies.runIteration()
      const outcome = await Promise.race([
        currentIteration.then(() => 'iteration' as const),
        shutdownRequested.then(() => 'shutdown' as const),
      ])
      if (outcome === 'shutdown') {
        await waitAtMost(currentIteration, dependencies.shutdownTimeoutMs)
        break
      }
      currentIteration = undefined
      if (stopping) break

      const sleepOutcome = await Promise.race([
        dependencies.sleep().then(() => 'sleep' as const),
        shutdownRequested.then(() => 'shutdown' as const),
      ])
      if (sleepOutcome === 'shutdown') break
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
    runIteration: async () => {
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
        })
        logger.info(result, 'worker iteration completed')
      } catch (error) {
        logger.error({ errorType: errorType(error) }, 'worker iteration failed')
        Sentry.captureException(error)
      }
    },
    sleep: () => delay(config.pollIntervalMs),
    closeHealthServer: () => closeServer(healthServer),
    closeDatabase: () => closeDatabase(database),
    flushSentry: (timeoutMs) => Sentry.flush(timeoutMs),
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

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function waitAtMost(
  operation: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, timeoutMs)
    void operation.then(
      () => {
        clearTimeout(timeout)
        resolve()
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error instanceof Error ? error : new Error('Operation failed'))
      },
    )
  })
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
