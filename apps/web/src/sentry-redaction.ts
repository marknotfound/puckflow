type RedactableEvent = {
  request?: {
    headers?: Record<string, string>
  }
}

export function redactSentryEvent<T extends RedactableEvent>(event: T): T {
  const headers = event.request?.headers
  if (!headers) return event

  const safeHeaders = Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !['authorization', 'cookie'].includes(name.toLowerCase()),
    ),
  )

  return {
    ...event,
    request: {
      ...event.request,
      headers: safeHeaders,
    },
  }
}
