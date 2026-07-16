import { and, eq } from 'drizzle-orm'

import type { Database, DbTransaction } from '../client.js'
import { webhookEvents } from '../schema/operations.js'

type WebhookDatabase = Database | DbTransaction

export class WebhookRepository {
  constructor(private readonly database: WebhookDatabase) {}

  async begin(
    providerEventId: string,
    eventType: string,
  ): Promise<'acquired' | 'duplicate'> {
    const inserted = await this.database
      .insert(webhookEvents)
      .values({ providerEventId, eventType, status: 'processing' })
      .onConflictDoNothing({ target: webhookEvents.providerEventId })
      .returning({ providerEventId: webhookEvents.providerEventId })
    return inserted.length === 1 ? 'acquired' : 'duplicate'
  }

  async markProcessed(providerEventId: string): Promise<void> {
    const updated = await this.database
      .update(webhookEvents)
      .set({
        status: 'processed',
        processedAt: new Date(),
        sanitizedError: null,
      })
      .where(
        and(
          eq(webhookEvents.providerEventId, providerEventId),
          eq(webhookEvents.status, 'processing'),
        ),
      )
      .returning({ providerEventId: webhookEvents.providerEventId })
    if (updated.length !== 1) {
      throw new Error('Webhook event is not in processing state')
    }
  }

  async markFailed(
    providerEventId: string,
    sanitizedError: string,
  ): Promise<void> {
    await this.database
      .update(webhookEvents)
      .set({ status: 'failed', processedAt: new Date(), sanitizedError })
      .where(
        and(
          eq(webhookEvents.providerEventId, providerEventId),
          eq(webhookEvents.status, 'processing'),
        ),
      )
  }
}
