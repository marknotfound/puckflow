import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')

describe('web deployment configuration', () => {
  it('keeps the API URL and Sentry auth token server-only', () => {
    const example = read('../../../.env.example')

    expect(example).toContain('API_INTERNAL_URL=http://127.0.0.1:3001')
    expect(example).toContain('SENTRY_AUTH_TOKEN=sntrys_example')
    expect(example).toContain('NEXT_PUBLIC_SENTRY_DSN=')
    expect(example).not.toContain('NEXT_PUBLIC_API_URL')
  })

  it('defines a public health route that does not import auth or API code', () => {
    const route = read('../app/api/health/route.ts')

    expect(route).toContain("return Response.json({ status: 'ok' })")
    expect(route).not.toMatch(/clerk|auth|api-client/i)
  })

  it('excludes health before Clerk and protects other non-auth routes', () => {
    const proxy = read('../proxy.ts')

    expect(proxy).toContain('api/health(?:/|$)')
    expect(proxy).not.toContain("createRouteMatcher(['/api/health'")
    expect(proxy).toContain("'/sign-in(.*)'")
    expect(proxy).toContain("'/sign-up(.*)'")
    expect(proxy).toContain('auth.protect()')
  })

  it('pins the Turbopack root to this repository', () => {
    const nextConfig = read('../next.config.ts')

    expect(nextConfig).toContain("root: resolve(import.meta.dirname, '../..')")
  })
})
