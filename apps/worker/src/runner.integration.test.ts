import { EventEmitter } from 'node:events'
import type { Server } from 'node:http'

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
    expect(handler).toHaveBeenNthCalledWith(1, {
      jobId: firstInput?.jobId,
      deterministicKey: 'smoke-1',
      payload: { deterministicKey: 'smoke-1' },
    })
    expect(handler).toHaveBeenNthCalledWith(2, {
      jobId: secondInput?.jobId,
      deterministicKey: 'smoke-2',
      payload: { deterministicKey: 'smoke-2' },
    })
    const rows = await database.select().from(jobs)
    expect(rows.filter(({ status }) => status === 'completed')).toHaveLength(2)
    expect(rows.filter(({ status }) => status === 'pending')).toHaveLength(1)
  })

  test('applies retry and dead-letter behavior to sanitized handler failures', async () => {
    await database.insert(jobs).values([
      { ...jobValues('retry'), maxAttempts: 2 },
      { ...jobValues('dead-letter'), maxAttempts: 1 },
    ])
    const failure = Object.assign(new Error('secret provider response'), {
      name: 'ProviderError',
      code: 'temporary_failure',
    })
    const captureException = vi.fn()

    const result = await runWorkerIteration({
      database,
      workerId: 'worker-failure',
      now,
      batchSize: 2,
      handlers: {
        'system.smoke': vi.fn<JobHandler>().mockRejectedValue(failure),
      },
      logger: logger(),
      sentry: { captureException },
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
          lastError: 'ProviderError: temporary_failure',
        }),
        expect.objectContaining({
          deterministicKey: 'dead-letter',
          status: 'dead_letter',
          lastError: 'ProviderError: temporary_failure',
        }),
      ]),
    )
    expect(JSON.stringify(rows)).not.toContain('secret provider response')
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
    const closeDatabase = vi.fn().mockResolvedValue(undefined)
    const flushSentry = vi.fn().mockResolvedValue(true)
    const running = runWorkerProcess({
      signals,
      runIteration: async () => {
        iterationStarted.resolve()
        await new Promise(() => undefined)
      },
      sleep: vi.fn().mockResolvedValue(undefined),
      closeHealthServer: vi.fn().mockResolvedValue(undefined),
      closeDatabase,
      flushSentry,
      shutdownTimeoutMs: 20,
      logger: logger(),
    })
    await iterationStarted.promise

    signals.emit('SIGTERM')
    await running

    expect(closeDatabase).toHaveBeenCalledOnce()
    expect(flushSentry).toHaveBeenCalledOnce()
  })
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
