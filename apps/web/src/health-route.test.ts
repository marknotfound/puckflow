// @vitest-environment node

import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, expect, it, vi } from 'vitest'

import { GET } from '../app/api/health/route.js'

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: vi.fn((handler: unknown) => handler),
  createRouteMatcher: vi.fn(() => () => false),
}))

describe('/api/health', () => {
  it('bypasses the complete Clerk proxy path before initialization', async () => {
    delete process.env.CLERK_SECRET_KEY
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

    Object.assign(globalThis, { AsyncLocalStorage })

    const response = GET()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })

    const [{ unstable_doesMiddlewareMatch }, { config }] = await Promise.all([
      import('next/experimental/testing/server.js'),
      import('../proxy.js'),
    ])

    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: 'https://web.puckflow.app/api/health',
      }),
    ).toBe(false)
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: 'https://web.puckflow.app/',
      }),
    ).toBe(true)
  })
})
