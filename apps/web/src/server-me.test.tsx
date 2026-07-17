import { ApiProblemError } from '@puckflow/api-client'
import { describe, expect, it, vi } from 'vitest'

import { toMeCardError } from './server-me.js'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createApiClient: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('@puckflow/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@puckflow/api-client')>()),
  createApiClient: mocks.createApiClient,
}))
const me = {
  id: '019c4ab8-ef80-7000-8000-000000000001',
  email: 'skater@example.com',
  displayName: 'Avery Skater',
  avatarUrl: null,
}

describe('server-only profile loading', () => {
  it('keeps the session JWT out of the rendered page and component props', async () => {
    const sessionJwt = 'session-jwt-must-never-be-serialized'
    const getToken = vi.fn().mockResolvedValue(sessionJwt)
    mocks.auth.mockResolvedValue({ getToken })
    mocks.createApiClient.mockReturnValue({
      getMe: vi.fn().mockResolvedValue(me),
    })
    process.env.API_INTERNAL_URL = 'http://127.0.0.1:3000'

    const { default: HomePage } = await import('../app/page.js')
    const page = await HomePage()

    expect(mocks.createApiClient).toHaveBeenCalledWith({
      baseUrl: process.env.API_INTERNAL_URL,
      getToken,
    })
    expect(JSON.stringify(page)).not.toContain(sessionJwt)
    expect(JSON.stringify(page)).toContain(me.id)
  })

  it('preserves validated API Problem Details for the profile card', () => {
    const error = new ApiProblemError({
      code: 'INTERNAL',
      status: 503,
      detail: 'Profile service is unavailable.',
      requestId: 'server-request-17',
    })

    expect(toMeCardError(error)).toEqual({
      detail: error.message,
      requestId: error.requestId,
    })
  })

  it('does not render unrestricted error messages', () => {
    const unrestricted = {
      name: 'ApiProblemError',
      message: 'session-jwt-do-not-render',
    }

    expect(toMeCardError(unrestricted)).toEqual({
      detail: 'Your profile is temporarily unavailable.',
    })
  })
})
