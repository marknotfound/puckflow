import { describe, expect, it, vi } from 'vitest'

import { ApiProblemError, createApiClient } from './client.js'

const me = {
  id: '019c4ab8-ef80-7000-8000-000000000001',
  email: 'skater@example.com',
  displayName: 'Avery Skater',
  avatarUrl: null,
}

describe('createApiClient', () => {
  it('rejects non-HTTPS non-loopback base URLs', () => {
    expect(() =>
      createApiClient({
        baseUrl: 'http://api.puckflow.app',
        getToken: () => Promise.resolve('session-jwt'),
      }),
    ).toThrow('API base URL must use HTTPS unless it is loopback')
  })

  it('gets and validates the signed-in user projection', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify(me), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = createApiClient({
      baseUrl: 'https://api.puckflow.app/',
      getToken: () => Promise.resolve('session-jwt'),
      fetch,
    })

    await expect(client.getMe()).resolves.toEqual(me)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('https://api.puckflow.app/v1/me', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer session-jwt',
      },
    })
  })

  it('rejects a missing token locally without calling fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = createApiClient({
      baseUrl: 'https://api.puckflow.app',
      getToken: () => Promise.resolve(null),
      fetch,
    })

    await expect(client.getMe()).rejects.toMatchObject({
      name: 'ApiProblemError',
      code: 'UNAUTHENTICATED',
      status: 401,
    } satisfies Partial<ApiProblemError>)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('turns a validated Problem Details response into ApiProblemError', async () => {
    const problem = {
      type: 'https://puckflow.app/problems/unauthenticated',
      title: 'Authentication required',
      status: 401,
      detail: 'Sign in to continue.',
      code: 'UNAUTHENTICATED',
      requestId: 'request-17',
      instance: '/v1/me',
    }
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(problem), { status: problem.status }),
      )
    const client = createApiClient({
      baseUrl: 'https://api.puckflow.app',
      getToken: () => Promise.resolve('session-jwt'),
      fetch,
    })

    await expect(client.getMe()).rejects.toMatchObject({
      name: 'ApiProblemError',
      code: problem.code,
      status: problem.status,
      requestId: problem.requestId,
      message: problem.detail,
      problem,
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    ['success', 200, '{"token":"do-not-expose"'],
    ['error', 500, 'upstream-secret-response'],
  ])(
    'turns malformed %s JSON into a safe INTERNAL error',
    async (_kind, status, responseText) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(responseText, { status }))
      const client = createApiClient({
        baseUrl: 'https://api.puckflow.app',
        getToken: () => Promise.resolve('session-jwt'),
        fetch,
      })

      let caught: unknown
      try {
        await client.getMe()
      } catch (error) {
        caught = error
      }

      expect(caught).toMatchObject({
        name: 'ApiProblemError',
        code: 'INTERNAL',
        status,
        message: 'The response could not be processed safely.',
      })
      expect(String(caught)).not.toContain(responseText)
    },
  )
})
