import { verifyWebhook } from '@clerk/express/webhooks'
import { UserRepository, WebhookRepository, type Database } from '@puckflow/db'
import type { Request, RequestHandler } from 'express'
import { z } from 'zod'

import { identityFromClerkProfile } from '../auth/clerk.js'
import { ProblemError } from '../http/problem.js'

export type ClerkWebhookEvent = {
  providerEventId: string
  type: string
  data: Record<string, unknown>
}

export interface ClerkWebhookVerifier {
  verify(request: Request): Promise<ClerkWebhookEvent>
}

const EmailSchema = z.object({
  id: z.string().min(1),
  email_address: z.email(),
  verification: z
    .object({ status: z.string().optional() })
    .nullable()
    .optional(),
})

const UserDataSchema = z.object({
  id: z.string().min(1),
  primary_email_address_id: z.string().nullable(),
  email_addresses: z.array(EmailSchema),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  image_url: z.string().default(''),
})

const DeletedUserDataSchema = z.object({ id: z.string().min(1) })

function identityFromWebhookData(data: Record<string, unknown>) {
  const parsed = UserDataSchema.parse(data)
  const fullName = [parsed.first_name, parsed.last_name]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
  return identityFromClerkProfile({
    id: parsed.id,
    fullName: fullName || null,
    username: parsed.username ?? null,
    imageUrl: parsed.image_url,
    primaryEmailAddressId: parsed.primary_email_address_id,
    emailAddresses: parsed.email_addresses.map((email) => ({
      id: email.id,
      emailAddress: email.email_address,
      verificationStatus: email.verification?.status,
    })),
  })
}

function sanitizedError(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError'
  const code =
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Za-z0-9._-]{1,64}$/.test(error.code)
      ? error.code
      : null
  return code ? `${error.name}:${code}` : error.name
}

export function createClerkWebhookVerifier(
  signingSecret: string,
): ClerkWebhookVerifier {
  return {
    async verify(request) {
      const event = await verifyWebhook(request, { signingSecret })
      const providerEventId = request.headers['svix-id']
      if (
        typeof providerEventId !== 'string' ||
        !/^[A-Za-z0-9._-]{1,255}$/.test(providerEventId)
      ) {
        throw new Error('Missing verified webhook event ID')
      }
      return {
        providerEventId,
        type: event.type,
        data: event.data as unknown as Record<string, unknown>,
      }
    },
  }
}

async function processEvent(
  database: Database,
  event: ClerkWebhookEvent,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const users = new UserRepository(transaction)
    if (event.type === 'user.created' || event.type === 'user.updated') {
      await users.upsertFromClerk(identityFromWebhookData(event.data))
    } else if (event.type === 'user.deleted') {
      const deleted = DeletedUserDataSchema.parse(event.data)
      await users.softDeleteByClerkId(deleted.id)
    }
    await new WebhookRepository(transaction).markProcessed(
      event.providerEventId,
    )
  })
}

export function createClerkWebhookHandler(options: {
  database: Database
  verifier: ClerkWebhookVerifier
}): RequestHandler {
  return async (request, response, next) => {
    let event: ClerkWebhookEvent
    try {
      event = await options.verifier.verify(request)
    } catch (cause) {
      next(
        new ProblemError({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Invalid webhook',
          detail: 'The webhook signature or payload is invalid.',
          cause,
        }),
      )
      return
    }

    const receipts = new WebhookRepository(options.database)
    try {
      const acquisition = await receipts.begin(
        event.providerEventId,
        event.type,
      )
      if (acquisition === 'duplicate') {
        response.status(200).json({ received: true, duplicate: true })
        return
      }

      try {
        await processEvent(options.database, event)
      } catch (cause) {
        await receipts.markFailed(event.providerEventId, sanitizedError(cause))
        throw new ProblemError({
          status: 500,
          code: 'INTERNAL',
          title: 'Webhook processing failed',
          detail: 'The webhook could not be processed.',
          cause,
        })
      }
      response.status(200).json({ received: true, duplicate: false })
    } catch (error) {
      next(error)
    }
  }
}
