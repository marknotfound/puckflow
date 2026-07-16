import type { DbTransaction } from '../client.js'
import { auditLogs, type AuditLog } from '../schema/operations.js'

export type AuditInput = {
  id: string
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string
  teamId: string | null
  requestId: string
  changes: Record<string, unknown>
  allowedChangeKeys: readonly string[]
}

const maximumChangesBytes = 2_048

export async function appendAudit(
  transaction: DbTransaction,
  input: AuditInput,
): Promise<AuditLog> {
  const allowedKeys = new Set(input.allowedChangeKeys)
  for (const key of Object.keys(input.changes)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Audit change key is not allowlisted: ${key}`)
    }
  }

  const serializedChanges = JSON.stringify(input.changes)
  if (
    new TextEncoder().encode(serializedChanges).byteLength > maximumChangesBytes
  ) {
    throw new Error(`Audit changes exceed ${maximumChangesBytes} bytes`)
  }

  const [auditLog] = await transaction
    .insert(auditLogs)
    .values({
      id: input.id,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      teamId: input.teamId,
      requestId: input.requestId,
      changes: input.changes,
    })
    .returning()

  if (!auditLog) throw new Error('Audit append did not return a row')
  return auditLog
}
