import {
  ProblemDetailsSchema,
  type ProblemCode,
  type ProblemDetails,
  type ValidationIssue,
} from '@puckflow/core'
import type { Request, Response } from 'express'
import { ZodError } from 'zod'

import { requestContext } from '../request-context.js'

export class ProblemError extends Error {
  readonly status: number
  readonly code: ProblemCode
  readonly title: string
  readonly detail: string
  readonly errors: ValidationIssue[] | undefined

  constructor(options: {
    status: number
    code: ProblemCode
    title: string
    detail: string
    errors?: ValidationIssue[]
    cause?: unknown
  }) {
    super(
      options.detail,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'ProblemError'
    this.status = options.status
    this.code = options.code
    this.title = options.title
    this.detail = options.detail
    this.errors = options.errors
  }
}

function zodProblem(error: ZodError): ProblemError {
  return new ProblemError({
    status: 400,
    code: 'VALIDATION_FAILED',
    title: 'Validation failed',
    detail: 'The request did not satisfy the required contract.',
    errors: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    })),
    cause: error,
  })
}

function isMalformedJson(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 400
  )
}

export function normalizeProblem(error: unknown): ProblemError {
  if (error instanceof ProblemError) return error
  if (error instanceof ZodError) return zodProblem(error)
  if (isMalformedJson(error)) {
    return new ProblemError({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Malformed JSON',
      detail: 'The request body must contain valid JSON.',
      cause: error,
    })
  }
  return new ProblemError({
    status: 500,
    code: 'INTERNAL',
    title: 'Internal server error',
    detail: 'An unexpected error occurred.',
    cause: error,
  })
}

export function toProblemDetails(
  error: unknown,
  request: Request,
  response: Response,
): ProblemDetails {
  const problem = normalizeProblem(error)
  return ProblemDetailsSchema.parse({
    type: `https://puckflow.app/problems/${problem.code.toLowerCase().replaceAll('_', '-')}`,
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
    code: problem.code,
    requestId: requestContext(response).requestId,
    instance: request.originalUrl || request.url,
    ...(problem.errors ? { errors: problem.errors } : {}),
  })
}
