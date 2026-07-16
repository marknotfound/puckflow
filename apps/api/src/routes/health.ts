import { sql } from 'drizzle-orm'
import { Router } from 'express'

import { ProblemError } from '../http/problem.js'

export interface HealthDatabase {
  execute(query: unknown): Promise<unknown>
}

export function createHealthRouter(database: HealthDatabase): Router {
  const router = Router()
  router.get('/health/live', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })
  router.get('/health/ready', async (_request, response, next) => {
    try {
      await database.execute(sql`select 1`)
      response.status(200).json({ status: 'ok' })
    } catch (cause) {
      next(
        new ProblemError({
          status: 503,
          code: 'INTERNAL',
          title: 'Service unavailable',
          detail: 'A required service is unavailable.',
          cause,
        }),
      )
    }
  })
  router.get('/v1/health', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })
  return router
}
