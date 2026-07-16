import { describe, expect, it } from 'vitest'

import { ProblemDetailsSchema, ValidationIssueSchema } from './problem.js'

const problem = {
  type: 'https://puckflow.app/problems/unauthenticated',
  title: 'Authentication required',
  status: 401,
  detail: 'Sign in to continue.',
  code: 'UNAUTHENTICATED',
  requestId: '019c-request',
  instance: '/v1/me',
} as const

describe('ProblemDetailsSchema', () => {
  it('accepts the shared RFC 9457 response contract', () => {
    expect(ProblemDetailsSchema.parse(problem)).toEqual(problem)
  })

  it('rejects error codes outside the stable problem code set', () => {
    expect(() =>
      ProblemDetailsSchema.parse({ ...problem, code: 'UNKNOWN_CODE' }),
    ).toThrow()
  })

  it('rejects validation issues without a path', () => {
    expect(() =>
      ValidationIssueSchema.parse({
        message: 'Required',
        code: 'invalid_type',
      }),
    ).toThrow()
  })
})
