import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'

import {
  closeDatabase,
  createDatabase,
  generateId,
  jobs,
  migrateDatabase,
  type Database,
} from '@puckflow/db'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import {
  runWorkerIteration,
  type JobHandler,
  type WorkerLogger,
} from './runner.js'
import { loadWorkerConfig } from './config.js'
import {
  createWorkerHealthServer,
  runWorkerProcess,
  type WorkerSignals,
} from './server.js'
import {
  startTestDatabase,
  type TestDatabase,
} from '../../../packages/db/src/testing/database.js'

const now = new Date('2026-07-16T12:00:00.000Z')

describe('worker iteration', () => {
  let container: TestDatabase
  let database: Database

  beforeAll(async () => {
    container = await startTestDatabase()
    await migrateDatabase(container.adminUrl)
    database = createDatabase(container.runtimeUrl)
  }, 120_000)

  beforeEach(async () => {
    await container.reset()
  })

  afterAll(async () => {
    if (database) await closeDatabase(database)
    await container?.stop()
  })

  test('claims a bounded batch, invokes handlers, and completes successes', async () => {
    await database
      .insert(jobs)
      .values([
        jobValues('smoke-1'),
        jobValues('smoke-2'),
        jobValues('outside-batch'),
      ])
    const handler = vi.fn<JobHandler>().mockResolvedValue(undefined)

    const result = await runWorkerIteration({
      database,
      workerId: 'worker-success',
      now,
      batchSize: 2,
      handlers: { 'system.smoke': handler },
      logger: logger(),
      sentry: sentry(),
      signal: new AbortController().signal,
    })

    expect(result).toEqual({
      claimedCount: 2,
      completedCount: 2,
      retriedCount: 0,
      deadLetteredCount: 0,
    })
    expect(handler).toHaveBeenCalledTimes(2)
    const firstInput = handler.mock.calls[0]?.[0]
    const secondInput = handler.mock.calls[1]?.[0]
    expect(typeof firstInput?.jobId).toBe('string')
    expect(typeof secondInput?.jobId).toBe('string')
    expect(firstInput?.signal).toBeInstanceOf(AbortSignal)
    expect(secondInput?.signal).toBeInstanceOf(AbortSignal)
    expect(handler).toHaveBeenNthCalledWith(1, {
      jobId: firstInput?.jobId,
      deterministicKey: 'smoke-1',
      payload: { deterministicKey: 'smoke-1' },
      signal: firstInput?.signal,
    })
    expect(handler).toHaveBeenNthCalledWith(2, {
      jobId: secondInput?.jobId,
      deterministicKey: 'smoke-2',
      payload: { deterministicKey: 'smoke-2' },
      signal: secondInput?.signal,
    })
    const rows = await database.select().from(jobs)
    expect(rows.filter(({ status }) => status === 'completed')).toHaveLength(2)
    expect(rows.filter(({ status }) => status === 'pending')).toHaveLength(1)
  })

  test('sanitizes secret-bearing handler failures in persistence, logs, and Sentry', async () => {
    await database.insert(jobs).values([
      { ...jobValues('retry'), maxAttempts: 2 },
      { ...jobValues('dead-letter'), maxAttempts: 1 },
    ])
    const failure = Object.assign(new Error('message-fixture-secret'), {
      name: 'ProviderError-name-fixture-secret=',
      code: 'code-fixture-secret=',
    })
    const captureException = vi.fn()
    const logError = vi.fn<WorkerLogger['error']>()
    const workerLogger: WorkerLogger = { info: vi.fn(), error: logError }

    const result = await runWorkerIteration({
      database,
      workerId: 'worker-failure',
      now,
      batchSize: 2,
      handlers: {
        'system.smoke': vi.fn<JobHandler>().mockRejectedValue(failure),
      },
      logger: workerLogger,
      sentry: { captureException },
      signal: new AbortController().signal,
    })

    expect(result).toEqual({
      claimedCount: 2,
      completedCount: 0,
      retriedCount: 1,
      deadLetteredCount: 1,
    })
    const rows = await database.select().from(jobs)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deterministicKey: 'retry',
          status: 'pending',
          lastError: 'Error: unknown_error',
        }),
        expect.objectContaining({
          deterministicKey: 'dead-letter',
          status: 'dead_letter',
          lastError: 'Error: unknown_error',
        }),
      ]),
    )
    const observableData = JSON.stringify({
      rows,
      logs: logError.mock.calls,
      sentry: captureException.mock.calls,
    })
    expect(observableData).not.toContain('fixture-secret')
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Error',
        message: 'Error: unknown_error',
      }),
      expect.any(Object),
    )
    expect(captureException).toHaveBeenCalledTimes(2)
  })

  test('fails an unknown category without completing it', async () => {
    await database
      .insert(jobs)
      .values({ ...jobValues('unknown'), category: 'unsupported_category' })

    const result = await runWorkerIteration({
      database,
      workerId: 'worker-unknown',
      now,
      batchSize: 1,
      handlers: {},
      logger: logger(),
      sentry: sentry(),
      signal: new AbortController().signal,
    })

    expect(result).toEqual({
      claimedCount: 1,
      completedCount: 0,
      retriedCount: 1,
      deadLetteredCount: 0,
    })
    await expect(database.select().from(jobs)).resolves.toEqual([
      expect.objectContaining({
        status: 'pending',
        completedAt: null,
        lastError: 'UnknownJobCategory: unsupported_category',
      }),
    ])
  })

  test('aborting a stuck handler releases it and every unstarted claimed job', async () => {
    await database
      .insert(jobs)
      .values([jobValues('stuck'), jobValues('unstarted')])
    const controller = new AbortController()
    const handlerStarted = deferred()
    const handler = vi.fn<JobHandler>(async () => {
      handlerStarted.resolve()
      await new Promise(() => undefined)
    })

    const running = runWorkerIteration({
      database,
      workerId: 'worker-shutdown',
      now,
      batchSize: 2,
      handlers: { 'system.smoke': handler },
      logger: logger(),
      sentry: sentry(),
      signal: controller.signal,
    })
    await handlerStarted.promise
    controller.abort()

    await expect(running).resolves.toEqual({
      claimedCount: 2,
      completedCount: 0,
      retriedCount: 2,
      deadLetteredCount: 0,
    })
    expect(handler).toHaveBeenCalledOnce()
    await expect(database.select().from(jobs)).resolves.toEqual([
      expect.objectContaining({
        deterministicKey: 'stuck',
        status: 'pending',
        claimedAt: null,
        claimedBy: null,
        lastError: 'WorkerShutdown: aborted',
      }),
      expect.objectContaining({
        deterministicKey: 'unstarted',
        status: 'pending',
        claimedAt: null,
        claimedBy: null,
        lastError: 'WorkerShutdown: aborted',
      }),
    ])
  })
})

describe('worker service lifecycle', () => {
  test('uses the exact defaults and rejects out-of-bounds worker settings', () => {
    const config = loadWorkerConfig({
      DATABASE_URL: 'postgresql://worker:secret@database:5432/puckflow',
    })
    expect(config).toMatchObject({
      batchSize: 20,
      pollIntervalMs: 1_000,
      shutdownTimeoutMs: 10_000,
      healthPort: 3_001,
    })
    expect(config.workerId).toMatch(/^[^:]+:\d+$/)

    for (const [name, value] of [
      ['WORKER_BATCH_SIZE', '0'],
      ['WORKER_BATCH_SIZE', '101'],
      ['WORKER_POLL_INTERVAL_MS', '99'],
      ['WORKER_POLL_INTERVAL_MS', '60001'],
      ['WORKER_SHUTDOWN_TIMEOUT_MS', '999'],
      ['WORKER_SHUTDOWN_TIMEOUT_MS', '30001'],
    ] as const) {
      expect(() =>
        loadWorkerConfig({
          DATABASE_URL: 'postgresql://worker:secret@database:5432/puckflow',
          [name]: value,
        }),
      ).toThrow()
    }
  })

  test('reports liveness without dependencies and readiness through select 1', async () => {
    const execute = vi.fn().mockResolvedValue([])
    const healthServer = createWorkerHealthServer({ execute })
    await listen(healthServer)
    const address = healthServer.address()
    if (!address || typeof address === 'string') throw new Error('No test port')

    await expect(responseAt(address.port, '/health/live')).resolves.toEqual({
      status: 200,
      body: { status: 'ok' },
    })
    expect(execute).not.toHaveBeenCalled()

    await expect(responseAt(address.port, '/health/ready')).resolves.toEqual({
      status: 200,
      body: { status: 'ok' },
    })
    expect(execute).toHaveBeenCalledOnce()

    execute.mockRejectedValueOnce(new Error('database password=secret'))
    await expect(responseAt(address.port, '/health/ready')).resolves.toEqual({
      status: 503,
      body: { status: 'unavailable' },
    })
    await close(healthServer)
  })

  test('SIGTERM stops new claims, bounds the current batch, and cleans resources', async () => {
    const signals = new EventEmitter() as EventEmitter & WorkerSignals
    let releaseIteration: (() => void) | undefined
    const iterationStarted = deferred()
    const runIteration = vi.fn(async () => {
      iterationStarted.resolve()
      await new Promise<void>((resolve) => {
        releaseIteration = resolve
      })
    })
    const closeHealthServer = vi.fn().mockResolvedValue(undefined)
    const closeDatabase = vi.fn().mockResolvedValue(undefined)
    const flushSentry = vi.fn().mockResolvedValue(true)

    const running = runWorkerProcess({
      signals,
      runIteration,
      sleep: vi.fn().mockResolvedValue(undefined),
      closeHealthServer,
      closeDatabase,
      flushSentry,
      forceExit: vi.fn(),
      shutdownTimeoutMs: 10_000,
      logger: logger(),
    })
    await iterationStarted.promise
    signals.emit('SIGTERM')
    releaseIteration?.()
    await running

    expect(runIteration).toHaveBeenCalledOnce()
    expect(closeHealthServer).toHaveBeenCalledOnce()
    expect(closeDatabase).toHaveBeenCalledOnce()
    expect(flushSentry).toHaveBeenCalledWith(2_000)
  })

  test('shutdown timeout bounds a stuck batch before cleanup', async () => {
    const signals = new EventEmitter() as EventEmitter & WorkerSignals
    const iterationStarted = deferred()
    const closeHealthServer = vi.fn().mockResolvedValue(undefined)
    const closeDatabase = vi.fn().mockResolvedValue(undefined)
    const flushSentry = vi.fn().mockResolvedValue(true)
    const forceExit = vi.fn()
    const running = runWorkerProcess({
      signals,
      runIteration: async () => {
        iterationStarted.resolve()
        await new Promise(() => undefined)
      },
      sleep: vi.fn().mockResolvedValue(undefined),
      closeHealthServer,
      closeDatabase,
      flushSentry,
      forceExit,
      shutdownTimeoutMs: 20,
      logger: logger(),
    })
    await iterationStarted.promise

    signals.emit('SIGTERM')
    await running

    expect(closeDatabase).toHaveBeenCalledOnce()
    expect(flushSentry).toHaveBeenCalledOnce()
    expect(forceExit).toHaveBeenCalledWith(1)
    expect(forceExit.mock.invocationCallOrder[0]).toBeGreaterThan(
      flushSentry.mock.invocationCallOrder[0] ?? 0,
    )
  })

  test.each([
    ['polling', 0],
    ['stuck-handler', 1],
  ] as const)(
    'a real SIGTERM during %s exits with code %i after cleanup',
    async (mode, expectedCode) => {
      const result = await runSignalFixture(mode)

      expect(result.code).toBe(expectedCode)
      expect(result.signal).toBeNull()
      expect(result.stdout).toContain('health-closed')
      expect(result.stdout).toContain('database-closed')
      expect(result.stdout).toContain('sentry-flushed')
      expect(result.elapsedMs).toBeLessThan(2_000)
    },
    5_000,
  )
})

function jobValues(deterministicKey: string) {
  return {
    id: generateId(),
    category: 'system.smoke',
    deterministicKey,
    payload: { deterministicKey },
    dueAt: now,
    nextAttemptAt: now,
  }
}

function logger(): WorkerLogger {
  return { info: vi.fn(), error: vi.fn() }
}

function sentry() {
  return { captureException: vi.fn() }
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

async function responseAt(port: number, path: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`)
  const body: unknown = await response.json()
  return { status: response.status, body }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolvePromise: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function runSignalFixture(mode: 'polling' | 'stuck-handler') {
  const fixturePath = fileURLToPath(
    new URL('../test-fixtures/worker-process.mjs', import.meta.url),
  )
  const child = spawn(process.execPath, [fixturePath, mode], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let signaled = false
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
    if (!signaled && stdout.includes('ready\n')) {
      signaled = true
      child.kill('SIGTERM')
    }
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  const startedAt = Date.now()

  const outcome = await new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
  }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Worker fixture timed out: ${stdout}\n${stderr}`))
    }, 2_500)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
  })

  return { ...outcome, stdout, stderr, elapsedMs: Date.now() - startedAt }
}
