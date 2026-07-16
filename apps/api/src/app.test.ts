import { ProblemDetailsSchema } from '@puckflow/core'
import { Router, type RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createApp, type AppDependencies } from './app.js'
import type { AppLogger } from './logger.js'

function dependencies(
  overrides: Partial<AppDependencies> = {},
): AppDependencies {
  return {
    config: {
      environment: 'test',
      release: 'api-test-release',
      trustProxy: false,
    },
    database: {
      execute: vi.fn().mockResolvedValue([]),
    },
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
    },
    ...overrides,
  }
}

function assertProblem(response: request.Response) {
  expect(response.headers['content-type']).toMatch(
    /^application\/problem\+json/,
  )
  const problem = ProblemDetailsSchema.parse(response.body)
  expect(problem).toEqual(response.body)
  expect(problem.requestId).toBe(response.headers['x-request-id'])
  return problem
}

describe('observable Express application', () => {
  test('serves public liveness and v1 health with security headers', async () => {
    const app = createApp(dependencies())

    const live = await request(app).get('/health/live').expect(200)
    expect(live.body).toEqual({ status: 'ok' })
    expect(live.headers['x-content-type-options']).toBe('nosniff')
    expect(live.headers['x-powered-by']).toBeUndefined()

    await request(app).get('/v1/health').expect(200, { status: 'ok' })
  })

  test('checks database readiness and reports dependency failures safely', async () => {
    const execute = vi.fn().mockResolvedValueOnce([])
    const app = createApp(dependencies({ database: { execute } }))

    await request(app).get('/health/ready').expect(200, { status: 'ok' })
    expect(execute).toHaveBeenCalledOnce()

    const failure = new Error('password=do-not-log database unavailable')
    execute.mockRejectedValueOnce(failure)
    const failed = await request(app)
      .get('/health/ready')
      .set('x-request-id', 'ready-check-1')
      .expect(503)

    assertProblem(failed)
    expect(failed.body).toMatchObject({
      code: 'INTERNAL',
      detail: 'A required service is unavailable.',
      instance: '/health/ready',
      requestId: 'ready-check-1',
    })
    expect(JSON.stringify(failed.body)).not.toContain('password')
  })

  test('returns schema-valid Problem Details for unknown routes', async () => {
    const response = await request(createApp(dependencies()))
      .get('/missing')
      .set('x-request-id', 'not-found-1')
      .expect(404)

    assertProblem(response)
    expect(response.body).toMatchObject({
      code: 'NOT_FOUND',
      detail: 'The requested resource was not found.',
      instance: '/missing',
      requestId: 'not-found-1',
    })
  })

  test.each([
    ['white space', 'whitespace'],
    ['contains/slash', 'slash'],
    ['x'.repeat(129), 'too long'],
    [['first', 'second'], 'multiple values'],
  ])('replaces an invalid request ID (%s: %s)', async (requestId, reason) => {
    void reason
    const response = await request(createApp(dependencies()))
      .get('/health/live')
      .set(
        'x-request-id',
        Array.isArray(requestId) ? requestId.join(',') : requestId,
      )
      .expect(200)

    const generated = response.headers['x-request-id'] as string
    expect(generated).not.toBe(requestId)
    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  test('echoes a valid inbound request ID', async () => {
    const info = vi.fn<AppLogger['info']>()
    const logger = { info, error: vi.fn<AppLogger['error']>() }
    const response = await request(createApp(dependencies({ logger })))
      .get('/health/live')
      .set('x-request-id', 'ci-smoke-1')
      .expect(200)

    expect(response.headers['x-request-id']).toBe('ci-smoke-1')
    expect(info).toHaveBeenCalledOnce()
    const [context, message] = info.mock.calls[0] ?? []
    expect(context).toMatchObject({
      requestId: 'ci-smoke-1',
      method: 'GET',
      path: '/health/live',
      status: 200,
    })
    expect(typeof context?.durationMs).toBe('number')
    expect(message).toBe('request completed')
  })

  test('correlates safe logs and Sentry context without request secrets', async () => {
    const failure = new Error('secret provider detail')
    const logger = { info: vi.fn(), error: vi.fn() }
    const captureException = vi.fn()
    const app = createApp(
      dependencies({
        database: { execute: vi.fn().mockRejectedValue(failure) },
        logger,
        sentry: { captureException },
      }),
    )

    const response = await request(app)
      .get('/health/ready')
      .set('authorization', 'Bearer never-log-me')
      .set('cookie', 'session=never-log-me')
      .set('x-request-id', 'correlation-1')
      .expect(503)

    assertProblem(response)
    expect(logger.error).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(
      {
        requestId: 'correlation-1',
        method: 'GET',
        path: '/health/ready',
        status: 503,
        errorType: 'Error',
      },
      'request failed',
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'never-log-me',
    )
    expect(captureException).toHaveBeenCalledWith(failure, {
      requestId: 'correlation-1',
      release: 'api-test-release',
      method: 'GET',
      path: '/health/ready',
      status: 503,
    })
  })

  test('limits /v1 independently from health and webhook traffic', async () => {
    const noOpWebhook: RequestHandler = (_request, response) => {
      response.status(200).json({ received: true })
    }
    const v1Router = Router()
    v1Router.get('/ping', (_request, response) => {
      response.status(200).json({ status: 'ok' })
    })
    const app = createApp(
      dependencies({ webhookHandler: noOpWebhook, v1Router }),
    )

    for (let index = 0; index < 5; index += 1) {
      await request(app).get('/health/live').expect(200)
      await request(app)
        .post('/webhooks/clerk')
        .set('content-type', 'application/json')
        .send('{}')
        .expect(200)
    }

    for (let index = 0; index < 120; index += 1) {
      await request(app).get('/v1/ping').expect(200)
    }

    const limited = await request(app).get('/v1/ping').expect(429)
    assertProblem(limited)
    expect(ProblemDetailsSchema.parse(limited.body).code).toBe('RATE_LIMITED')
  })
})
