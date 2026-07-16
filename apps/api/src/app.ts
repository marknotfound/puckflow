import express, { type Express, type RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'

import type { IdentityProvider } from './auth/clerk.js'
import type { AuthAdapter } from './auth/require-auth.js'
import type { IdentityUserRepository } from './auth/provision-user.js'
import { createErrorHandler } from './http/error-handler.js'
import { notFound } from './http/not-found.js'
import { ProblemError, toProblemDetails } from './http/problem.js'
import type { AppLogger } from './logger.js'
import type { Observability } from './observability.js'
import { requestContext, requestContextMiddleware } from './request-context.js'
import { createHealthRouter, type HealthDatabase } from './routes/health.js'
import {
  createClerkWebhookHandler,
  type ClerkWebhookVerifier,
} from './routes/clerk-webhooks.js'
import { createMeRouter } from './routes/me.js'

export type AppDependencies = {
  config: {
    environment: string
    release: string
    trustProxy: boolean
  }
  database: HealthDatabase
  logger: AppLogger
  sentry: Observability
  webhookHandler?: RequestHandler
  webhooks?: {
    database: import('@puckflow/db').Database
    verifier: ClerkWebhookVerifier
  }
  clerkMiddleware?: RequestHandler
  v1Router?: RequestHandler
  auth?: AuthAdapter
  users?: IdentityUserRepository
  identityProvider?: IdentityProvider
}

const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
  'req.headers.svix-id',
  'req.headers.svix-signature',
  'req.headers.svix-timestamp',
  '*.databaseUrl',
  '*.token',
  '*.secret',
  '*.password',
]

function problemRateLimit(max: number) {
  return rateLimit({
    windowMs: 60_000,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(request, response) {
      const error = new ProblemError({
        status: 429,
        code: 'RATE_LIMITED',
        title: 'Too many requests',
        detail: 'Too many requests. Try again later.',
      })
      response
        .status(429)
        .type('application/problem+json')
        .json(toProblemDetails(error, request, response))
    },
  })
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express()
  app.disable('x-powered-by')
  if (dependencies.config.trustProxy) app.set('trust proxy', 1)

  app.use(requestContextMiddleware)
  app.use(
    pinoHttp({
      autoLogging: false,
      quietReqLogger: true,
      redact: { paths: redactedPaths, censor: '[Redacted]' },
    }),
  )
  app.use(helmet())
  app.use((request, response, next) => {
    const startedAt = performance.now()
    response.once('finish', () => {
      if (response.statusCode < 400) {
        dependencies.logger.info(
          {
            requestId: requestContext(response).requestId,
            method: request.method,
            path: request.path,
            status: response.statusCode,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          },
          'request completed',
        )
      }
    })
    next()
  })

  app.post(
    '/webhooks/clerk',
    problemRateLimit(300),
    express.raw({ type: 'application/json', limit: '1mb' }),
    dependencies.webhookHandler ??
      (dependencies.webhooks
        ? createClerkWebhookHandler(dependencies.webhooks)
        : (_request, response) => response.sendStatus(404)),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(createHealthRouter(dependencies.database))
  if (dependencies.clerkMiddleware) app.use(dependencies.clerkMiddleware)
  app.use('/v1', problemRateLimit(120))
  if (
    dependencies.auth &&
    dependencies.users &&
    dependencies.identityProvider
  ) {
    app.use(
      '/v1',
      createMeRouter({
        auth: dependencies.auth,
        users: dependencies.users,
        identityProvider: dependencies.identityProvider,
      }),
    )
  }
  if (dependencies.v1Router) app.use('/v1', dependencies.v1Router)
  app.use(notFound)
  app.use(
    createErrorHandler({
      logger: dependencies.logger,
      sentry: dependencies.sentry,
      release: dependencies.config.release,
    }),
  )
  return app
}
