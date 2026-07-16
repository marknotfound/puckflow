import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { closeDatabase, createDatabase, type Database } from '../client.js'
import { generateId } from '../ids.js'
import { migrateDatabase } from '../migrate.js'
import { auditLogs, jobs, outboxEvents, users } from '../schema/index.js'
import { startTestDatabase, type TestDatabase } from '../testing/database.js'
import { appendAudit } from './audit.js'
import { claimJobs, completeJob, failJob } from './jobs.js'
import { dispatchOutboxBatch, enqueueOutbox } from './outbox.js'

const actorId = '019c4ab8-ef80-7000-8000-000000000011'
const entityId = '019c4ab8-ef80-7000-8000-000000000012'

describe('operational repositories', () => {
  let container: TestDatabase
  let database: Database

  beforeAll(async () => {
    container = await startTestDatabase()
    await migrateDatabase(container.adminUrl)
    database = createDatabase(container.runtimeUrl)
  }, 120_000)

  beforeEach(async () => {
    await container.reset()
    await database.insert(users).values({
      id: actorId,
      clerkId: 'user_operations_actor',
      email: 'actor@example.com',
      displayName: 'Original Name',
    })
  })

  afterAll(async () => {
    if (database) await closeDatabase(database)
    await container?.stop()
  })

  test('domain mutation, audit, and outbox commit together', async () => {
    await database.transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({ displayName: 'Updated Name' })
        .where(eq(users.id, actorId))
      await appendAudit(transaction, {
        id: generateId(),
        actorUserId: actorId,
        action: 'user.updated',
        entityType: 'user',
        entityId,
        teamId: null,
        requestId: 'atomic-commit',
        changes: {
          displayName: { before: 'Original Name', after: 'Updated Name' },
        },
        allowedChangeKeys: ['displayName'],
      })
      await enqueueOutbox(transaction, {
        id: generateId(),
        eventType: 'user.updated',
        aggregateType: 'user',
        aggregateId: entityId,
        teamId: null,
        actorUserId: actorId,
        payload: { userId: entityId },
        requestId: 'atomic-commit',
        occurredAt: new Date('2026-07-15T12:00:00.000Z'),
      })
    })

    await expect(database.select().from(auditLogs)).resolves.toHaveLength(1)
    await expect(database.select().from(outboxEvents)).resolves.toHaveLength(1)
    await expect(database.select().from(users)).resolves.toEqual([
      expect.objectContaining({ displayName: 'Updated Name' }),
    ])
  })

  test('domain mutation, audit, and outbox roll back together', async () => {
    await expect(
      database.transaction(async (transaction) => {
        await transaction
          .update(users)
          .set({ displayName: 'Must Roll Back' })
          .where(eq(users.id, actorId))
        await appendAudit(transaction, {
          id: generateId(),
          actorUserId: actorId,
          action: 'user.updated',
          entityType: 'user',
          entityId,
          teamId: null,
          requestId: 'atomic-rollback',
          changes: { displayName: { after: 'Must Roll Back' } },
          allowedChangeKeys: ['displayName'],
        })
        await enqueueOutbox(transaction, {
          id: generateId(),
          eventType: 'user.updated',
          aggregateType: 'user',
          aggregateId: entityId,
          teamId: null,
          actorUserId: actorId,
          payload: { userId: entityId },
          requestId: 'atomic-rollback',
          occurredAt: new Date('2026-07-15T12:00:00.000Z'),
        })
        throw new Error('force rollback')
      }),
    ).rejects.toThrow('force rollback')

    await expect(database.select().from(auditLogs)).resolves.toHaveLength(0)
    await expect(database.select().from(outboxEvents)).resolves.toHaveLength(0)
    await expect(database.select().from(users)).resolves.toEqual([
      expect.objectContaining({ displayName: 'Original Name' }),
    ])
  })

  test('audit changes reject non-allowlisted keys and payloads over 2 KiB', async () => {
    const baseInput = {
      id: generateId(),
      actorUserId: actorId,
      action: 'user.updated',
      entityType: 'user',
      entityId,
      teamId: null,
      requestId: 'audit-validation',
      allowedChangeKeys: ['displayName'] as const,
    }

    await expect(
      database.transaction((transaction) =>
        appendAudit(transaction, {
          ...baseInput,
          changes: { email: { after: 'not-allowed@example.com' } },
        }),
      ),
    ).rejects.toThrow('Audit change key is not allowlisted: email')

    await expect(
      database.transaction((transaction) =>
        appendAudit(transaction, {
          ...baseInput,
          id: generateId(),
          changes: { displayName: 'x'.repeat(2_049) },
        }),
      ),
    ).rejects.toThrow('Audit changes exceed 2048 bytes')
  })

  test('dispatch is repeat-safe and creates one deterministic job per outbox event', async () => {
    const eventId = generateId()
    const now = new Date('2026-07-15T12:00:00.000Z')
    await database.transaction((transaction) =>
      enqueueOutbox(transaction, {
        id: eventId,
        eventType: 'system.smoke',
        aggregateType: 'user',
        aggregateId: entityId,
        teamId: null,
        actorUserId: actorId,
        payload: { safe: true },
        requestId: 'dispatch-repeat',
        occurredAt: now,
      }),
    )

    await expect(
      dispatchOutboxBatch(database, { now, limit: 10 }),
    ).resolves.toBe(1)
    await expect(
      dispatchOutboxBatch(database, { now, limit: 10 }),
    ).resolves.toBe(0)

    await expect(database.select().from(jobs)).resolves.toEqual([
      expect.objectContaining({
        deterministicKey: `outbox:${eventId}`,
        category: 'system.smoke',
        payload: { safe: true },
      }),
    ])
    await expect(database.select().from(outboxEvents)).resolves.toEqual([
      expect.objectContaining({ dispatchedAt: now }),
    ])
  })

  test('concurrent claimers never receive the same job and claim only due pending jobs', async () => {
    const now = new Date('2026-07-15T12:00:00.000Z')
    await database
      .insert(jobs)
      .values([
        jobValues('due-1', now),
        jobValues('due-2', now),
        jobValues('due-3', now),
        jobValues('future', new Date('2026-07-15T12:01:00.000Z')),
        { ...jobValues('already-complete', now), status: 'completed' },
      ])

    const [first, second] = await Promise.all([
      claimJobs(database, { workerId: 'worker-a', now, limit: 2 }),
      claimJobs(database, { workerId: 'worker-b', now, limit: 2 }),
    ])
    const claimed = [...first, ...second]

    expect(claimed).toHaveLength(3)
    expect(new Set(claimed.map(({ id }) => id)).size).toBe(3)
    expect(
      claimed.map(({ deterministicKey }) => deterministicKey).sort(),
    ).toEqual(['due-1', 'due-2', 'due-3'])
    expect(claimed.every(({ attemptCount }) => attemptCount === 1)).toBe(true)
  })

  test('completion is idempotent for the same claimant', async () => {
    const now = new Date('2026-07-15T12:00:00.000Z')
    await database.insert(jobs).values(jobValues('complete-me', now))
    const [claimed] = await claimJobs(database, {
      workerId: 'worker-a',
      now,
      limit: 1,
    })

    await expect(
      completeJob(database, { jobId: claimed!.id, workerId: 'worker-a', now }),
    ).resolves.toBe(true)
    await expect(
      completeJob(database, { jobId: claimed!.id, workerId: 'worker-a', now }),
    ).resolves.toBe(true)
    await expect(
      completeJob(database, { jobId: claimed!.id, workerId: 'worker-b', now }),
    ).resolves.toBe(false)
  })

  test('failures use bounded backoff, clear claims, and dead-letter at max attempts', async () => {
    const firstNow = new Date('2026-07-15T12:00:00.000Z')
    await database
      .insert(jobs)
      .values({ ...jobValues('retry-me', firstNow), maxAttempts: 2 })
    const [firstClaim] = await claimJobs(database, {
      workerId: 'worker-a',
      now: firstNow,
      limit: 1,
    })

    await expect(
      failJob(database, {
        jobId: firstClaim!.id,
        workerId: 'worker-a',
        now: firstNow,
        errorName: 'ProviderError',
        errorCode: 'temporary_failure',
      }),
    ).resolves.toBe('pending')
    await expect(database.select().from(jobs)).resolves.toEqual([
      expect.objectContaining({
        status: 'pending',
        attemptCount: 1,
        nextAttemptAt: new Date('2026-07-15T12:00:02.000Z'),
        claimedAt: null,
        claimedBy: null,
        lastError: 'ProviderError: temporary_failure',
      }),
    ])

    const retryAt = new Date('2026-07-15T12:00:02.000Z')
    const [secondClaim] = await claimJobs(database, {
      workerId: 'worker-b',
      now: retryAt,
      limit: 1,
    })
    await expect(
      failJob(database, {
        jobId: secondClaim!.id,
        workerId: 'worker-b',
        now: retryAt,
        errorName: 'ProviderError',
        errorCode: 'permanent_failure',
      }),
    ).resolves.toBe('dead_letter')
    await expect(database.select().from(jobs)).resolves.toEqual([
      expect.objectContaining({
        status: 'dead_letter',
        attemptCount: 2,
        deadLetteredAt: retryAt,
        claimedAt: null,
        claimedBy: null,
        lastError: 'ProviderError: permanent_failure',
      }),
    ])
  })

  test('retry backoff is capped at five minutes', async () => {
    const now = new Date('2026-07-15T12:00:00.000Z')
    await database.insert(jobs).values({
      ...jobValues('bounded-retry', now),
      attemptCount: 8,
      maxAttempts: 10,
    })
    const [claimed] = await claimJobs(database, {
      workerId: 'worker-a',
      now,
      limit: 1,
    })

    await expect(
      failJob(database, {
        jobId: claimed!.id,
        workerId: 'worker-a',
        now,
        errorName: 'ProviderError',
        errorCode: 'temporary_failure',
      }),
    ).resolves.toBe('pending')
    await expect(database.select().from(jobs)).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 9,
        nextAttemptAt: new Date('2026-07-15T12:05:00.000Z'),
      }),
    ])
  })

  test('runtime database role cannot update or delete audit rows', async () => {
    const auditId = generateId()
    await database.transaction((transaction) =>
      appendAudit(transaction, {
        id: auditId,
        actorUserId: actorId,
        action: 'user.updated',
        entityType: 'user',
        entityId,
        teamId: null,
        requestId: 'runtime-permission',
        changes: { displayName: { after: 'Safe' } },
        allowedChangeKeys: ['displayName'],
      }),
    )
    const runtime = postgres(container.runtimeUrl, { max: 1 })

    await expect(
      runtime`UPDATE audit_logs SET action = 'tampered' WHERE id = ${auditId}`,
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      runtime`DELETE FROM audit_logs WHERE id = ${auditId}`,
    ).rejects.toMatchObject({
      code: '42501',
    })
    await runtime.end()
  })
})

function jobValues(deterministicKey: string, dueAt: Date) {
  return {
    id: generateId(),
    category: 'system.smoke',
    deterministicKey,
    payload: { deterministicKey },
    dueAt,
    nextAttemptAt: dueAt,
  }
}
