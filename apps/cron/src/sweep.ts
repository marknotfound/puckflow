import { dispatchOutboxBatch, type Database } from '@puckflow/db'

export interface SweepLogger {
  info(context: Record<string, unknown>, message: string): void
}

export type SweepResult = { dispatchedCount: number }

export async function runSweep(dependencies: {
  database: Database
  now: Date
  logger: SweepLogger
}): Promise<SweepResult> {
  const startedAt = performance.now()
  const dispatchedCount = await dispatchOutboxBatch(dependencies.database, {
    now: dependencies.now,
    limit: 100,
  })
  dependencies.logger.info(
    {
      dispatchedCount,
      durationMs: Math.round(performance.now() - startedAt),
    },
    'cron sweep completed',
  )
  return { dispatchedCount }
}
