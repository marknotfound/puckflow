import { describe, expect, it } from 'vitest'

import { redactSentryEvent } from './sentry-redaction.js'

describe('redactSentryEvent', () => {
  it('removes request cookies even when headers are absent', () => {
    const event = redactSentryEvent({
      request: {
        cookies: { __session: 'cookie-only-do-not-keep' },
        url: 'https://puckflow.app/',
      },
    })

    expect(event.request).toEqual({ url: 'https://puckflow.app/' })
    expect(JSON.stringify(event)).not.toContain('cookie-only-do-not-keep')
  })

  it('removes sensitive headers when request cookies are absent', () => {
    const event = redactSentryEvent({
      request: {
        headers: {
          authorization: 'Bearer header-only-do-not-keep',
          accept: 'text/html',
        },
      },
    })

    expect(event.request?.headers).toEqual({ accept: 'text/html' })
    expect(JSON.stringify(event)).not.toContain('header-only-do-not-keep')
  })

  it('matches authorization and cookie header names case-insensitively', () => {
    const event = redactSentryEvent({
      request: {
        headers: {
          AuThOrIzAtIoN: 'Bearer mixed-case-token-do-not-keep',
          cOoKiE: '__session=mixed-case-cookie-do-not-keep',
          accept: 'text/html',
        },
      },
    })

    expect(event.request?.headers).toEqual({ accept: 'text/html' })
    expect(JSON.stringify(event)).not.toContain('mixed-case-token-do-not-keep')
    expect(JSON.stringify(event)).not.toContain('mixed-case-cookie-do-not-keep')
  })

  it('removes request cookies and sensitive headers together', () => {
    const event = redactSentryEvent({
      request: {
        cookies: { __session: 'combined-cookie-do-not-keep' },
        headers: {
          Authorization: 'Bearer combined-token-do-not-keep',
          Cookie: '__session=combined-header-cookie-do-not-keep',
          accept: 'application/json',
        },
      },
    })

    expect(event.request).toEqual({
      headers: { accept: 'application/json' },
    })
    expect(JSON.stringify(event)).not.toMatch(/combined-.*-do-not-keep/)
  })
})
