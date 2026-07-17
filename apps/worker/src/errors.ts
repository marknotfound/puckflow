const SAFE_ERROR_PART = /^[A-Za-z][A-Za-z0-9._-]{0,79}$/

export type WorkerErrorIdentity = {
  errorName: string
  errorCode: string
}

export function safeErrorIdentity(error: unknown): WorkerErrorIdentity {
  if (typeof error !== 'object' || error === null) {
    return { errorName: 'Error', errorCode: 'unknown_error' }
  }
  const candidate = error as { name?: unknown; code?: unknown }
  return {
    errorName: safePart(candidate.name, 'Error'),
    errorCode: safePart(candidate.code, 'unknown_error'),
  }
}

export function sanitizedWorkerException(error: unknown): Error & {
  code: string
} {
  const { errorName, errorCode } = safeErrorIdentity(error)
  const sanitized = Object.assign(new Error(`${errorName}: ${errorCode}`), {
    code: errorCode,
  })
  sanitized.name = errorName
  return sanitized
}

export function workerShutdownError(): Error & { code: string } {
  return Object.assign(new Error('Worker shutdown requested'), {
    name: 'WorkerShutdown',
    code: 'aborted',
  })
}

function safePart(value: unknown, fallback: string): string {
  return typeof value === 'string' && SAFE_ERROR_PART.test(value)
    ? value
    : fallback
}
