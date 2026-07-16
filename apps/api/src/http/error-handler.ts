import type { ErrorRequestHandler } from 'express'

import type { AppLogger } from '../logger.js'
import type { Observability } from '../observability.js'
import { requestContext } from '../request-context.js'
import { normalizeProblem, ProblemError, toProblemDetails } from './problem.js'

export function createErrorHandler(options: {
  logger: AppLogger
  sentry: Observability
  release: string
}): ErrorRequestHandler {
  return (error, request, response, next) => {
    void next
    const unknownError: unknown = error
    const problem = normalizeProblem(unknownError)
    const capturedError =
      unknownError instanceof ProblemError && unknownError.cause !== undefined
        ? unknownError.cause
        : unknownError
    const { requestId } = requestContext(response)
    const safeContext = {
      requestId,
      method: request.method,
      path: request.path,
      status: problem.status,
      errorType:
        capturedError instanceof Error ? capturedError.name : 'UnknownError',
    }

    if (problem.status >= 500) {
      options.logger.error(safeContext, 'request failed')
      options.sentry.captureException(capturedError, {
        requestId,
        release: options.release,
        method: request.method,
        path: request.path,
        status: problem.status,
      })
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .json(toProblemDetails(problem, request, response))
  }
}
