import { loadConfig } from './config.js'
import { createLogger } from './logger.js'
import {
  flushSentry,
  initializeSentry,
  sentryObservability,
} from './observability.js'

async function main(): Promise<void> {
  const config = loadConfig()
  initializeSentry({
    ...(config.sentryDsn ? { dsn: config.sentryDsn } : {}),
    environment: config.sentryEnvironment,
    release: config.sentryRelease,
  })

  const [clerk, databasePackage, appPackage, identityPackage, webhookPackage] =
    await Promise.all([
      import('@clerk/express'),
      import('@puckflow/db'),
      import('./app.js'),
      import('./auth/clerk.js'),
      import('./routes/clerk-webhooks.js'),
    ])

  const database = databasePackage.createDatabase(config.databaseUrl)
  const users = new databasePackage.UserRepository(database)
  const logger = createLogger({
    level: config.logLevel,
    environment: config.sentryEnvironment,
    release: config.sentryRelease,
  })
  const app = appPackage.createApp({
    config: {
      environment: config.nodeEnvironment,
      release: config.sentryRelease,
      trustProxy: config.trustProxy,
    },
    database: {
      execute: (query) => database.execute(query as never),
    },
    logger,
    sentry: sentryObservability,
    clerkMiddleware: clerk.clerkMiddleware({
      publishableKey: config.clerkPublishableKey,
      secretKey: config.clerkSecretKey,
    }),
    auth: {
      getAuth(request) {
        const auth = clerk.getAuth(request)
        return { isAuthenticated: auth.isAuthenticated, userId: auth.userId }
      },
    },
    users,
    identityProvider: identityPackage.createClerkIdentityProvider({
      publishableKey: config.clerkPublishableKey,
      secretKey: config.clerkSecretKey,
    }),
    webhooks: {
      database,
      verifier: webhookPackage.createClerkWebhookVerifier(
        config.clerkWebhookSigningSecret,
      ),
    },
  })

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'api listening')
  })
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'api shutting down')
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    await databasePackage.closeDatabase(database)
    await flushSentry(2_000)
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown(signal)
        .then(() => {
          process.exitCode = 0
        })
        .catch(() => {
          process.exitCode = 1
        })
    })
  }
}

void main().catch(async () => {
  process.stderr.write('API failed to start\n')
  await flushSentry(2_000)
  process.exitCode = 1
})
