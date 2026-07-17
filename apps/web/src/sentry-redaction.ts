import type { Event } from '@sentry/nextjs'

export function redactSentryEvent<T extends Event>(event: T): T {
  if (!event.request) return event

  const safeRequest = { ...event.request }
  delete safeRequest.cookies
  const { headers } = safeRequest
  if (!headers) {
    return { ...event, request: safeRequest }
  }

  const safeHeaders = Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !['authorization', 'cookie'].includes(name.toLowerCase()),
    ),
  )

  return {
    ...event,
    request: {
      ...safeRequest,
      headers: safeHeaders,
    },
  }
}
