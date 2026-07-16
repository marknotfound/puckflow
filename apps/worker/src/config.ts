import { hostname } from 'node:os'

import { z } from 'zod'

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.url().optional(),
)

const WorkerConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
  DATABASE_URL: z.url(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  WORKER_ID: z.string().min(1).default(`${hostname()}:${process.pid}`),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  WORKER_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(1_000),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(30_000)
    .default(10_000),
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().min(1).default('development'),
  SENTRY_RELEASE: z.string().min(1).default('local'),
})

export type WorkerConfig = {
  healthPort: number
  databaseUrl: string
  logLevel: string
  workerId: string
  batchSize: number
  pollIntervalMs: number
  shutdownTimeoutMs: number
  sentryDsn?: string
  sentryEnvironment: string
  sentryRelease: string
}

export function loadWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const config = WorkerConfigSchema.parse(environment)
  return {
    healthPort: config.PORT,
    databaseUrl: config.DATABASE_URL,
    logLevel: config.LOG_LEVEL,
    workerId: config.WORKER_ID,
    batchSize: config.WORKER_BATCH_SIZE,
    pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
    shutdownTimeoutMs: config.WORKER_SHUTDOWN_TIMEOUT_MS,
    ...(config.SENTRY_DSN ? { sentryDsn: config.SENTRY_DSN } : {}),
    sentryEnvironment: config.SENTRY_ENVIRONMENT,
    sentryRelease: config.SENTRY_RELEASE,
  }
}
