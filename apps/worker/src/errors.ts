export type WorkerErrorIdentity = {
  errorName: string
  errorCode: string
}

const UNKNOWN_ERROR: WorkerErrorIdentity = {
  errorName: 'Error',
  errorCode: 'unknown_error',
}
const trustedIdentities = new WeakMap<object, WorkerErrorIdentity>()

export function safeErrorIdentity(error: unknown): WorkerErrorIdentity {
  if (
    (typeof error !== 'object' && typeof error !== 'function') ||
    error === null
  ) {
    return UNKNOWN_ERROR
  }
  return trustedIdentities.get(error) ?? UNKNOWN_ERROR
}

export function sanitizedWorkerException(error: unknown): Error & {
  code: string
} {
  return trustedWorkerError(safeErrorIdentity(error))
}

export function workerShutdownError(): Error & { code: string } {
  return trustedWorkerError({
    errorName: 'WorkerShutdown',
    errorCode: 'aborted',
  })
}

export function unknownJobCategoryError(): Error & { code: string } {
  return trustedWorkerError({
    errorName: 'UnknownJobCategory',
    errorCode: 'unsupported_category',
  })
}

export function jobCompletionError(): Error & { code: string } {
  return trustedWorkerError({
    errorName: 'JobCompletionError',
    errorCode: 'claim_lost',
  })
}

function trustedWorkerError(
  identity: WorkerErrorIdentity,
): Error & { code: string } {
  const error = Object.assign(
    new Error(`${identity.errorName}: ${identity.errorCode}`),
    { code: identity.errorCode },
  )
  error.name = identity.errorName
  trustedIdentities.set(error, identity)
  return error
}
