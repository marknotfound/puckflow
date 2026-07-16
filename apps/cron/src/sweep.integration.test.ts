import {
  closeDatabase,
  createDatabase,
  enqueueOutbox,
  generateId,
  jobs,
  migrateDatabase,
  outboxEvents,
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

import { runSweep, type SweepLogger } from './sweep.js'
import { executeCron, type CronLogger } from './main.js'
import {
  startTestDatabase,
  type TestDatabase,
} from '../../../packages/db/src/testing/database.js'

const now = new Date('2026-07-16T12:00:00.000Z')

describe('cron dispatch sweep', () => {
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

  test('dispatches one deterministic job once and is repeat-safe', async () => {
    const eventId = generateId()
    await insertOutbox(database, eventId)
    const info = vi.fn<SweepLogger['info']>()

    await expect(
      runSweep({ database, now, logger: { info } }),
    ).resolves.toEqual({ dispatchedCount: 1 })
    await expect(
      runSweep({ database, now, logger: { info } }),
    ).resolves.toEqual({ dispatchedCount: 0 })

    await expect(database.select().from(jobs)).resolves.toEqual([
      expect.objectContaining({
        category: 'system.smoke',
        deterministicKey: `outbox:${eventId}`,
        payload: { eventId },
      }),
    ])
    await expect(database.select().from(outboxEvents)).resolves.toEqual([
      expect.objectContaining({ dispatchedAt: now }),
    ])
    const [context, message] = info.mock.calls.at(-1) ?? []
    expect(context).toMatchObject({ dispatchedCount: 0 })
    expect(typeof context?.durationMs).toBe('number')
    expect(message).toBe('cron sweep completed')
  })

  test('dispatches at most 100 rows in one bounded sweep', async () => {
    for (let index = 0; index < 101; index += 1) {
      await insertOutbox(database, generateId())
    }

    await expect(
      runSweep({ database, now, logger: logger() }),
    ).resolves.toEqual({ dispatchedCount: 100 })
    await expect(database.select().from(jobs)).resolves.toHaveLength(100)
    await expect(database.select().from(outboxEvents)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ dispatchedAt: null })]),
    )
  })
})

describe('cron process contract', () => {
  test('closes the database and Sentry and exits 0 after one sweep', async () => {
    const closeDatabase = vi.fn().mockResolvedValue(undefined)
    const flushSentry = vi.fn().mockResolvedValue(true)
    const exitCode = await executeCron({
      runSweep: vi.fn().mockResolvedValue({ dispatchedCount: 1 }),
      closeDatabase,
      flushSentry,
      captureException: vi.fn(),
      logger: logger(),
    })

    expect(exitCode).toBe(0)
    expect(closeDatabase).toHaveBeenCalledOnce()
    expect(flushSentry).toHaveBeenCalledWith(2_000)
  })

  test('captures database failures, logs safely, cleans up, and exits 1', async () => {
    const failure = new Error(
      'postgresql://runtime:never-log-this@database/puckflow',
    )
    const error = vi.fn()
    const captureException = vi.fn()
    const closeDatabase = vi.fn().mockResolvedValue(undefined)
    const flushSentry = vi.fn().mockResolvedValue(true)
    const exitCode = await executeCron({
      runSweep: vi.fn().mockRejectedValue(failure),
      closeDatabase,
      flushSentry,
      captureException,
      logger: { info: vi.fn(), error },
    })

    expect(exitCode).toBe(1)
    expect(captureException).toHaveBeenCalledWith(failure)
    expect(error).toHaveBeenCalledWith(
      { errorType: 'Error' },
      'cron sweep failed',
    )
    expect(JSON.stringify(error.mock.calls)).not.toContain('never-log-this')
    expect(closeDatabase).toHaveBeenCalledOnce()
    expect(flushSentry).toHaveBeenCalledWith(2_000)
  })
})

async function insertOutbox(
  database: Database,
  eventId: string,
): Promise<void> {
  await database.transaction((transaction) =>
    enqueueOutbox(transaction, {
      id: eventId,
      eventType: 'system.smoke',
      aggregateType: 'system',
      aggregateId: generateId(),
      teamId: null,
      actorUserId: null,
      payload: { eventId },
      requestId: 'cron-integration',
      occurredAt: now,
    }),
  )
}

function logger(): CronLogger {
  return { info: vi.fn(), error: vi.fn() }
}
