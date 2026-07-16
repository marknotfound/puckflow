import { asc, inArray, isNull } from 'drizzle-orm'

import type { Database, DbTransaction } from '../client.js'
import { generateId } from '../ids.js'
import { jobs, outboxEvents, type OutboxEvent } from '../schema/operations.js'

export type OutboxInput = {
  id: string
  eventType: string
  aggregateType: string
  aggregateId: string
  teamId: string | null
  actorUserId: string | null
  payload: Record<string, unknown>
  requestId: string
  occurredAt: Date
}

export async function enqueueOutbox(
  transaction: DbTransaction,
  input: OutboxInput,
): Promise<OutboxEvent> {
  const [outboxEvent] = await transaction
    .insert(outboxEvents)
    .values(input)
    .returning()
  if (!outboxEvent) throw new Error('Outbox enqueue did not return a row')
  return outboxEvent
}

export async function dispatchOutboxBatch(
  database: Database,
  input: { now: Date; limit: number },
): Promise<number> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error(
      'Outbox dispatch limit must be an integer from 1 through 100',
    )
  }

  return database.transaction(async (transaction) => {
    const events = await transaction
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.dispatchedAt))
      .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id))
      .limit(input.limit)
      .for('update', { skipLocked: true })

    if (events.length === 0) return 0

    await transaction
      .insert(jobs)
      .values(
        events.map((event) => ({
          id: generateId(),
          category: event.eventType,
          deterministicKey: `outbox:${event.id}`,
          payload: event.payload,
          dueAt: input.now,
          nextAttemptAt: input.now,
        })),
      )
      .onConflictDoNothing({ target: jobs.deterministicKey })

    await transaction
      .update(outboxEvents)
      .set({ dispatchedAt: input.now })
      .where(
        inArray(
          outboxEvents.id,
          events.map(({ id }) => id),
        ),
      )

    return events.length
  })
}
