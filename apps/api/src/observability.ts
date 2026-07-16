import * as Sentry from '@sentry/node'

export type CapturedErrorContext = {
  requestId: string
  release: string
  method: string
  path: string
  status: number
}

export interface Observability {
  captureException(error: unknown, context: CapturedErrorContext): void
}

export function initializeSentry(options: {
  dsn?: string
  environment: string
  release: string
}): void {
  Sentry.init({
    dsn: options.dsn,
    enabled: Boolean(options.dsn),
    environment: options.environment,
    release: options.release,
    sendDefaultPii: false,
  })
}

export const sentryObservability: Observability = {
  captureException(error, context) {
    Sentry.withScope((scope) => {
      scope.setTag('requestId', context.requestId)
      scope.setTag('release', context.release)
      scope.setContext('request', {
        requestId: context.requestId,
        method: context.method,
        path: context.path,
        status: context.status,
      })
      Sentry.captureException(error)
    })
  },
}

export async function flushSentry(timeoutMs = 2_000): Promise<boolean> {
  return Sentry.flush(timeoutMs)
}
