import {
  MeSchema,
  ProblemDetailsSchema,
  type Me,
  type ProblemCode,
  type ProblemDetails,
} from '@puckflow/core'

import { normalizeApiBaseUrl } from './transport.js'

export class ApiProblemError extends Error {
  readonly code: ProblemCode
  readonly status: number
  readonly requestId: string | undefined
  readonly problem: ProblemDetails | undefined

  constructor(options: {
    code: ProblemCode
    status: number
    detail: string
    requestId?: string
    problem?: ProblemDetails
  }) {
    super(options.detail)
    this.name = 'ApiProblemError'
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
    this.problem = options.problem
  }
}

export type ApiClientOptions = {
  baseUrl: string
  getToken: () => Promise<string | null>
  fetch?: typeof globalThis.fetch
}

export interface ApiClient {
  getMe(): Promise<Me>
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = normalizeApiBaseUrl(options.baseUrl)
  const fetch = options.fetch ?? globalThis.fetch

  return {
    async getMe() {
      const token = await options.getToken()
      if (!token) {
        throw new ApiProblemError({
          code: 'UNAUTHENTICATED',
          status: 401,
          detail: 'Sign in to continue.',
        })
      }
      const response = await fetch(`${baseUrl}/v1/me`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const body: unknown = await readJson(response)
      if (!response.ok) {
        const mediaType = response.headers
          .get('content-type')
          ?.split(';', 1)[0]
          ?.trim()
          .toLowerCase()
        if (mediaType !== 'application/problem+json') {
          throw internalResponseError(response.status)
        }
        const result = ProblemDetailsSchema.safeParse(body)
        if (!result.success || result.data.status !== response.status) {
          throw internalResponseError(response.status)
        }
        const problem = result.data
        throw new ApiProblemError({
          code: problem.code,
          status: problem.status,
          detail: problem.detail,
          requestId: problem.requestId,
          problem,
        })
      }
      const result = MeSchema.safeParse(body)
      if (!result.success) {
        throw internalResponseError(response.status)
      }
      return result.data
    },
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw internalResponseError(response.status)
  }
}

function internalResponseError(status: number): ApiProblemError {
  return new ApiProblemError({
    code: 'INTERNAL',
    status,
    detail: 'The response could not be processed safely.',
  })
}
