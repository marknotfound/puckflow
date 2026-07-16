import { z } from 'zod'

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.url().optional(),
)

const ConfigSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.url(),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1),
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().min(1).default('development'),
  SENTRY_RELEASE: z.string().min(1).default('local'),
})

export type ApiConfig = {
  nodeEnvironment: 'development' | 'test' | 'production'
  port: number
  logLevel: string
  databaseUrl: string
  clerkPublishableKey: string
  clerkSecretKey: string
  clerkWebhookSigningSecret: string
  sentryDsn?: string
  sentryEnvironment: string
  sentryRelease: string
  trustProxy: boolean
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const config = ConfigSchema.parse(environment)
  return {
    nodeEnvironment: config.NODE_ENV,
    port: config.PORT,
    logLevel: config.LOG_LEVEL,
    databaseUrl: config.DATABASE_URL,
    clerkPublishableKey: config.CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: config.CLERK_SECRET_KEY,
    clerkWebhookSigningSecret: config.CLERK_WEBHOOK_SIGNING_SECRET,
    ...(config.SENTRY_DSN ? { sentryDsn: config.SENTRY_DSN } : {}),
    sentryEnvironment: config.SENTRY_ENVIRONMENT,
    sentryRelease: config.SENTRY_RELEASE,
    trustProxy: config.NODE_ENV === 'production',
  }
}
