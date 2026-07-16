import { z } from 'zod'

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.url().optional(),
)

const CronConfigSchema = z.object({
  DATABASE_URL: z.url(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().min(1).default('development'),
  SENTRY_RELEASE: z.string().min(1).default('local'),
})

export type CronConfig = {
  databaseUrl: string
  logLevel: string
  sentryDsn?: string
  sentryEnvironment: string
  sentryRelease: string
}

export function loadCronConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CronConfig {
  const config = CronConfigSchema.parse(environment)
  return {
    databaseUrl: config.DATABASE_URL,
    logLevel: config.LOG_LEVEL,
    ...(config.SENTRY_DSN ? { sentryDsn: config.SENTRY_DSN } : {}),
    sentryEnvironment: config.SENTRY_ENVIRONMENT,
    sentryRelease: config.SENTRY_RELEASE,
  }
}
