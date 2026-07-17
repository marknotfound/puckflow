import { describe, expect, it } from 'vitest'

import { redactSentryEvent } from './sentry-redaction.js'

describe('redactSentryEvent', () => {
  it('removes authorization and cookie headers without retaining their values', () => {
    const event = redactSentryEvent({
      request: {
        headers: {
          authorization: 'Bearer session-jwt-do-not-keep',
          Cookie: '__session=cookie-do-not-keep',
          accept: 'text/html',
        },
      },
    })

    expect(event.request?.headers).toEqual({ accept: 'text/html' })
    expect(JSON.stringify(event)).not.toContain('session-jwt-do-not-keep')
    expect(JSON.stringify(event)).not.toContain('cookie-do-not-keep')
  })
})
