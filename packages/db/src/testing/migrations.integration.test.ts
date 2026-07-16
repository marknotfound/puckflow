import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { startTestDatabase, type TestDatabase } from './database.js'

const migrationPath = fileURLToPath(
  new URL('../../drizzle/0000_m0_foundations.sql', import.meta.url),
)

describe('Milestone 0 migrations', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await startTestDatabase()
  }, 120_000)

  afterAll(async () => {
    await database?.stop()
  })

  test('migrates an empty database and is repeat-safe', async () => {
    await access(migrationPath)
    const { migrateDatabase } = await import('../migrate.js')

    await expect(migrateDatabase(database.adminUrl)).resolves.toBe(1)
    await expect(migrateDatabase(database.adminUrl)).resolves.toBe(0)

    const admin = postgres(database.adminUrl, { max: 1 })
    const tables = await admin<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `

    expect(tables.map(({ table_name }) => table_name)).toEqual([
      'audit_logs',
      'jobs',
      'outbox_events',
      'users',
      'webhook_events',
    ])

    const primaryKeys = await admin<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND constraint_type = 'PRIMARY KEY'
      ORDER BY table_name
    `
    expect(primaryKeys.map(({ table_name }) => table_name)).toEqual([
      'audit_logs',
      'jobs',
      'outbox_events',
      'users',
      'webhook_events',
    ])

    const uniqueColumns = await admin<
      { table_name: string; column_name: string }[]
    >`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.constraint_schema = kcu.constraint_schema
      WHERE tc.constraint_schema = 'public' AND tc.constraint_type = 'UNIQUE'
      ORDER BY tc.table_name, kcu.column_name
    `
    expect(uniqueColumns).toEqual(
      expect.arrayContaining([
        { table_name: 'jobs', column_name: 'deterministic_key' },
        { table_name: 'users', column_name: 'clerk_id' },
      ]),
    )

    const enumLabels = await admin<{ typname: string; enumlabel: string }[]>`
      SELECT t.typname, e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('job_status', 'webhook_event_status')
      ORDER BY t.typname, e.enumsortorder
    `
    expect(enumLabels).toEqual([
      { typname: 'job_status', enumlabel: 'pending' },
      { typname: 'job_status', enumlabel: 'claimed' },
      { typname: 'job_status', enumlabel: 'completed' },
      { typname: 'job_status', enumlabel: 'canceled' },
      { typname: 'job_status', enumlabel: 'dead_letter' },
      { typname: 'webhook_event_status', enumlabel: 'processing' },
      { typname: 'webhook_event_status', enumlabel: 'processed' },
      { typname: 'webhook_event_status', enumlabel: 'failed' },
    ])

    await expect(
      admin`
        INSERT INTO jobs (
          id, category, deterministic_key, payload, due_at, status,
          attempt_count, max_attempts, next_attempt_at, created_at, updated_at
        ) VALUES (
          ${randomUUID()}, 'invalid', ${`invalid:${randomUUID()}`}, '{}'::jsonb,
          now(), 'pending', -1, 1, now(), now(), now()
        )
      `,
    ).rejects.toMatchObject({ code: '23514' })

    await admin.end()
  })

  test('grants runtime inserts while audit records stay append-only', async () => {
    const runtime = postgres(database.runtimeUrl, { max: 1 })
    const userId = '019c4ab8-ef80-7000-8000-000000000001'
    const auditId = '019c4ab8-ef80-7000-8000-000000000002'

    await runtime`
      INSERT INTO users (id, clerk_id, email, display_name)
      VALUES (${userId}, 'clerk_migration_test', 'skater@example.com', 'Avery Skater')
    `
    await runtime`
      INSERT INTO webhook_events (provider_event_id, event_type, status)
      VALUES ('evt_migration_test', 'user.updated', 'processing')
    `
    await runtime`
      INSERT INTO audit_logs (
        id, actor_user_id, action, entity_type, entity_id, request_id, changes
      ) VALUES (
        ${auditId}, ${userId}, 'user.updated', 'user', ${userId},
        'migration-role-test', '{"displayName":{"after":"Avery"}}'::jsonb
      )
    `
    await runtime`
      INSERT INTO outbox_events (
        id, event_type, aggregate_type, aggregate_id, actor_user_id,
        payload, request_id, occurred_at
      ) VALUES (
        '019c4ab8-ef80-7000-8000-000000000003', 'user.updated', 'user',
        ${userId}, ${userId}, '{}'::jsonb, 'migration-role-test', now()
      )
    `
    await runtime`
      INSERT INTO jobs (
        id, category, deterministic_key, payload, due_at, next_attempt_at
      ) VALUES (
        '019c4ab8-ef80-7000-8000-000000000004', 'user.updated',
        'migration-role-test', '{}'::jsonb, now(), now()
      )
    `

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
