import { AsyncLocalStorage } from 'node:async_hooks'

import { generateId } from '@puckflow/db'
import type { RequestHandler, Response } from 'express'

export type RequestContext = {
  requestId: string
  user?: { id: string; clerkId: string }
}

const storage = new AsyncLocalStorage<RequestContext>()
const validRequestId = /^[A-Za-z0-9._-]{1,128}$/

function inboundRequestId(
  header: string | string[] | undefined,
): string | null {
  return typeof header === 'string' && validRequestId.test(header)
    ? header
    : null
}

export const requestContextMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  const requestId =
    inboundRequestId(request.headers['x-request-id']) ?? generateId()
  const context: RequestContext = { requestId }
  response.locals.requestContext = context
  response.setHeader('x-request-id', requestId)
  storage.run(context, next)
}

export function requestContext(response: Response): RequestContext {
  const context = response.locals.requestContext as RequestContext | undefined
  if (!context) throw new Error('Request context is unavailable')
  return context
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore()
}
