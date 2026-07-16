import { createHmac, randomBytes } from 'node:crypto'

import { ProblemDetailsSchema } from '@puckflow/core'
import {
  closeDatabase,
  createDatabase,
  migrateDatabase,
  users,
  webhookEvents,
  type Database,
} from '@puckflow/db'
import { eq, sql } from 'drizzle-orm'
import request from 'supertest'
import { z } from 'zod'
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
  startTestDatabase,
  type TestDatabase,
} from '../../../../packages/db/src/testing/database.js'
import { createApp, type AppDependencies } from '../app.js'
import {
  createClerkWebhookVerifier,
  type ClerkWebhookEvent,
  type ClerkWebhookVerifier,
} from './clerk-webhooks.js'

type MutableEvent = ClerkWebhookEvent & { data: Record<string, unknown> }
const WebhookResponseSchema = z.object({
  received: z.boolean(),
  duplicate: z.boolean(),
})

function userEvent(
  providerEventId: string,
  type: 'user.created' | 'user.updated' | 'user.deleted',
  overrides: Record<string, unknown> = {},
): MutableEvent {
  return {
    providerEventId,
    type,
    data: {
      id: 'user_webhook',
      primary_email_address_id: 'email_primary',
      email_addresses: [
        {
          id: 'email_primary',
          email_address: 'webhook@example.com',
          verification: { status: 'verified' },
        },
      ],
      first_name: 'Webhook',
      last_name: 'Skater',
      username: 'webhook_skater',
      image_url: 'https://img.example.com/webhook.png',
      ...overrides,
    },
  }
}

function dependencies(
  database: Database,
  verifier: ClerkWebhookVerifier,
): AppDependencies {
  return {
    config: {
      environment: 'test',
      release: 'api-test-release',
      trustProxy: false,
    },
    database,
    logger: { info: vi.fn(), error: vi.fn() },
    sentry: { captureException: vi.fn() },
    webhooks: { database, verifier },
  }
}

function signedHeaders(secret: string, id: string, body: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  }
}

function assertProblem(response: request.Response, code: string) {
  expect(response.headers['content-type']).toMatch(
    /^application\/problem\+json/,
  )
  const problem = ProblemDetailsSchema.parse(response.body)
  expect(problem).toEqual(response.body)
  expect(problem.code).toBe(code)
  return problem
}

describe('POST /webhooks/clerk', () => {
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

  test.each(['user.created', 'user.updated'] as const)(
    'upserts a user for a verified %s event',
    async (type) => {
      const event = userEvent(`evt_${type}`, type)
      const app = createApp(
        dependencies(database, { verify: vi.fn().mockResolvedValue(event) }),
      )

      const response = await request(app)
        .post('/webhooks/clerk')
        .set('content-type', 'application/json')
        .send('{}')
        .expect(200)

      expect(response.body).toEqual({ received: true, duplicate: false })
      const [user] = await database
        .select()
        .from(users)
        .where(eq(users.clerkId, 'user_webhook'))
      expect(user).toMatchObject({
        email: 'webhook@example.com',
        displayName: 'Webhook Skater',
        clerkImageUrl: 'https://img.example.com/webhook.png',
        deletedAt: null,
      })
    },
  )

  test('soft deletes a synchronized user without removing its identity', async () => {
    const verifier = { verify: vi.fn() }
    const app = createApp(dependencies(database, verifier))
    verifier.verify.mockResolvedValueOnce(
      userEvent('evt_create', 'user.created'),
    )
    await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .send('{}')
      .expect(200)

    verifier.verify.mockResolvedValueOnce(
      userEvent('evt_delete', 'user.deleted'),
    )
    await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .send('{}')
      .expect(200)

    const [deleted] = await database
      .select()
      .from(users)
      .where(eq(users.clerkId, 'user_webhook'))
    expect(deleted?.deletedAt).toBeInstanceOf(Date)
  })

  test('deduplicates a replay before a second mutation', async () => {
    const event = userEvent('evt_replay', 'user.created')
    const verifier = { verify: vi.fn().mockResolvedValue(event) }
    const app = createApp(dependencies(database, verifier))

    await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .send('{}')
      .expect(200, { received: true, duplicate: false })

    event.data.first_name = 'Mutated Replay'
    const replay = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .send('{}')
      .expect(200)

    expect(replay.body).toEqual({ received: true, duplicate: true })
    const [user] = await database
      .select()
      .from(users)
      .where(eq(users.clerkId, 'user_webhook'))
    expect(user?.displayName).toBe('Webhook Skater')
  })

  test('allows only one concurrent delivery to acquire an event', async () => {
    const event = userEvent('evt_concurrent', 'user.created')
    const app = createApp(
      dependencies(database, { verify: vi.fn().mockResolvedValue(event) }),
    )

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post('/webhooks/clerk')
          .set('content-type', 'application/json')
          .send('{}')
          .expect(200),
      ),
    )

    const bodies = responses.map((response) =>
      WebhookResponseSchema.parse(response.body),
    )
    expect(bodies.filter((body) => body.duplicate === false)).toHaveLength(1)
    expect(bodies.filter((body) => body.duplicate === true)).toHaveLength(7)
    const receipts = await database
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, 'evt_concurrent'))
    expect(receipts).toHaveLength(1)
  })

  test('records unsupported verified events as processed', async () => {
    const app = createApp(
      dependencies(database, {
        verify: vi.fn().mockResolvedValue({
          providerEventId: 'evt_unsupported',
          type: 'session.created',
          data: { id: 'sess_1' },
        }),
      }),
    )

    await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .send('{}')
      .expect(200, { received: true, duplicate: false })

    const [receipt] = await database
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, 'evt_unsupported'))
    expect(receipt).toMatchObject({ status: 'processed', sanitizedError: null })
  })

  test('returns schema-valid validation errors for invalid signatures', async () => {
    const app = createApp(
      dependencies(database, {
        verify: vi.fn().mockRejectedValue(new Error('signature secret detail')),
      }),
    )

    const response = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .send('{}')
      .expect(400)

    assertProblem(response, 'VALIDATION_FAILED')
    expect(JSON.stringify(response.body)).not.toContain('secret')
  })

  test('records a sanitized failure without storing the raw payload', async () => {
    const malformed = userEvent('evt_failed', 'user.created', {
      primary_email_address_id: 'missing',
      unrestricted_secret: 'never-store-this',
    })
    const app = createApp(
      dependencies(database, { verify: vi.fn().mockResolvedValue(malformed) }),
    )

    const response = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .send('{"raw":"never-store-this"}')
      .expect(500)

    assertProblem(response, 'INTERNAL')
    const [receipt] = await database
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, 'evt_failed'))
    expect(receipt).toMatchObject({
      status: 'failed',
      sanitizedError: 'IdentityConflictError',
    })
    expect(JSON.stringify(receipt)).not.toContain('never-store-this')
  })

  test('rolls back the user mutation when marking processed fails', async () => {
    const admin = createDatabase(container.adminUrl)
    await admin.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION reject_processed_webhook() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.provider_event_id = 'evt_rollback' AND NEW.status = 'processed' THEN
          RAISE EXCEPTION 'forced processed failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_processed_webhook
      BEFORE UPDATE ON webhook_events
      FOR EACH ROW EXECUTE FUNCTION reject_processed_webhook();
    `),
    )
    await closeDatabase(admin)

    const app = createApp(
      dependencies(database, {
        verify: vi
          .fn()
          .mockResolvedValue(userEvent('evt_rollback', 'user.created')),
      }),
    )
    await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .send('{}')
      .expect(500)

    const insertedUsers = await database
      .select()
      .from(users)
      .where(eq(users.clerkId, 'user_webhook'))
    expect(insertedUsers).toHaveLength(0)
    const [receipt] = await database
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, 'evt_rollback'))
    expect(receipt?.status).toBe('failed')
  })

  test('verifies a real Standard Webhooks signature through Clerk', async () => {
    const secret = `whsec_${randomBytes(32).toString('base64')}`
    const eventId = 'evt_signed_fixture'
    const body = JSON.stringify({
      type: 'session.created',
      object: 'event',
      data: { id: 'sess_fixture' },
      event_attributes: { http_request: { client_ip: '', user_agent: '' } },
    })
    const app = createApp(
      dependencies(database, createClerkWebhookVerifier(secret)),
    )

    await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set(signedHeaders(secret, eventId, body))
      .send(body)
      .expect(200, { received: true, duplicate: false })

    const [receipt] = await database
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, eventId))
    expect(receipt?.status).toBe('processed')
  })
})
