import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { users } from './users.js'

export const webhookEventStatus = pgEnum('webhook_event_status', [
  'processing',
  'processed',
  'failed',
])

export const jobStatus = pgEnum('job_status', [
  'pending',
  'claimed',
  'completed',
  'canceled',
  'dead_letter',
])

export const webhookEvents = pgTable('webhook_events', {
  providerEventId: text('provider_event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  status: webhookEventStatus('status').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  sanitizedError: text('sanitized_error'),
})

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  teamId: uuid('team_id'),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  changes: jsonb('changes').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    teamId: uuid('team_id'),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    requestId: varchar('request_id', { length: 128 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  },
  (table) => [
    index('outbox_events_undispatched_idx')
      .on(table.occurredAt, table.id)
      .where(sql`${table.dispatchedAt} IS NULL`),
  ],
)

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    category: text('category').notNull(),
    deterministicKey: text('deterministic_key').notNull().unique(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: jobStatus('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', {
      withTimezone: true,
    }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedBy: text('claimed_by'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('jobs_attempt_count_nonnegative', sql`${table.attemptCount} >= 0`),
    check('jobs_max_attempts_positive', sql`${table.maxAttempts} > 0`),
    index('jobs_claim_idx').on(table.status, table.nextAttemptAt, table.dueAt),
  ],
)

export type AuditLog = typeof auditLogs.$inferSelect
export type OutboxEvent = typeof outboxEvents.$inferSelect
export type Job = typeof jobs.$inferSelect
