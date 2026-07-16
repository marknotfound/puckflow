import { MeSchema, ProblemDetailsSchema } from '@puckflow/core'
import type { User } from '@puckflow/db'
import request from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { IdentityProvider } from '../auth/clerk.js'
import { IdentityConflictError } from '../auth/clerk.js'
import { createApp, type AppDependencies } from '../app.js'

const existingUser: User = {
  id: '019c4ab8-ef80-7000-8000-000000000001',
  clerkId: 'user_avery',
  email: 'avery@example.com',
  displayName: 'Avery Skater',
  clerkImageUrl: null,
  createdAt: new Date('2026-07-15T00:00:00.000Z'),
  updatedAt: new Date('2026-07-15T00:00:00.000Z'),
  deletedAt: null,
}

class MemoryUsers {
  readonly users = new Map<string, User>()

  findByClerkId(clerkId: string): Promise<User | null> {
    return Promise.resolve(this.users.get(clerkId) ?? null)
  }

  upsertFromClerk(input: {
    clerkId: string
    email: string
    displayName: string
    clerkImageUrl: string | null
  }): Promise<User> {
    const current = this.users.get(input.clerkId)
    const user: User = {
      id: current?.id ?? '019c4ab8-ef80-7000-8000-000000000002',
      ...input,
      createdAt: current?.createdAt ?? new Date('2026-07-15T00:00:00.000Z'),
      updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      deletedAt: null,
    }
    this.users.set(input.clerkId, user)
    return Promise.resolve(user)
  }
}

function dependencies(
  options: {
    authenticatedClerkId?: string | null
    users?: MemoryUsers
    identityProvider?: IdentityProvider
  } = {},
): AppDependencies {
  return {
    config: {
      environment: 'test',
      release: 'api-test-release',
      trustProxy: false,
    },
    database: { execute: vi.fn().mockResolvedValue([]) },
    logger: { info: vi.fn(), error: vi.fn() },
    sentry: { captureException: vi.fn() },
    auth: {
      getAuth: () => ({
        isAuthenticated: Boolean(options.authenticatedClerkId),
        userId: options.authenticatedClerkId ?? null,
      }),
    },
    users: options.users ?? new MemoryUsers(),
    identityProvider: options.identityProvider ?? {
      getUser: vi.fn().mockResolvedValue(existingUser),
    },
  }
}

function expectProblem(response: request.Response, code: string) {
  expect(response.headers['content-type']).toMatch(
    /^application\/problem\+json/,
  )
  const problem = ProblemDetailsSchema.parse(response.body)
  expect(problem).toEqual(response.body)
  expect(problem.code).toBe(code)
  expect(problem.requestId).toBe(response.headers['x-request-id'])
  return problem
}

describe('GET /v1/me', () => {
  test('rejects an unauthenticated request with Problem Details', async () => {
    const response = await request(createApp(dependencies()))
      .get('/v1/me')
      .expect(401)

    expectProblem(response, 'UNAUTHENTICATED')
  })

  test('returns an existing internal user without contacting Clerk', async () => {
    const users = new MemoryUsers()
    users.users.set(existingUser.clerkId, existingUser)
    const identityProvider = { getUser: vi.fn() }

    const response = await request(
      createApp(
        dependencies({
          authenticatedClerkId: existingUser.clerkId,
          users,
          identityProvider,
        }),
      ),
    )
      .get('/v1/me')
      .expect(200)

    expect(MeSchema.parse(response.body)).toEqual({
      id: existingUser.id,
      email: existingUser.email,
      displayName: existingUser.displayName,
      avatarUrl: null,
    })
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(identityProvider.getUser).not.toHaveBeenCalled()
  })

  test('provisions a missing internal user exactly once from Clerk', async () => {
    const users = new MemoryUsers()
    const identityProvider = {
      getUser: vi.fn().mockResolvedValue({
        clerkId: 'user_new',
        email: 'new@example.com',
        displayName: 'New Skater',
        clerkImageUrl: 'https://img.example.com/new.png',
      }),
    }
    const app = createApp(
      dependencies({
        authenticatedClerkId: 'user_new',
        users,
        identityProvider,
      }),
    )

    const response = await request(app).get('/v1/me').expect(200)

    expect(identityProvider.getUser).toHaveBeenCalledOnce()
    expect(identityProvider.getUser).toHaveBeenCalledWith('user_new')
    expect(users.users.get('user_new')).toMatchObject({
      email: 'new@example.com',
      displayName: 'New Skater',
    })
    expect(MeSchema.parse(response.body).email).toBe('new@example.com')
  })

  test('returns safe conflict when Clerk has no verified primary email', async () => {
    const response = await request(
      createApp(
        dependencies({
          authenticatedClerkId: 'user_unverified',
          identityProvider: {
            getUser: vi.fn().mockRejectedValue(new IdentityConflictError()),
          },
        }),
      ),
    )
      .get('/v1/me')
      .expect(409)

    expectProblem(response, 'CONFLICT')
    expect(ProblemDetailsSchema.parse(response.body).detail).toBe(
      'A verified primary email address is required.',
    )
  })

  test('returns generic 503 and does not insert when Clerk is unavailable', async () => {
    const users = new MemoryUsers()
    const response = await request(
      createApp(
        dependencies({
          authenticatedClerkId: 'user_provider_failure',
          users,
          identityProvider: {
            getUser: vi
              .fn()
              .mockRejectedValue(new Error('token=secret upstream detail')),
          },
        }),
      ),
    )
      .get('/v1/me')
      .expect(503)

    expectProblem(response, 'INTERNAL')
    expect(ProblemDetailsSchema.parse(response.body).detail).toBe(
      'Identity service is unavailable.',
    )
    expect(JSON.stringify(response.body)).not.toContain('secret')
    expect(users.users.size).toBe(0)
  })
})
