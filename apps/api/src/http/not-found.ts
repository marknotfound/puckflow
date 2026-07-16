import type { RequestHandler } from 'express'

import { ProblemError } from './problem.js'

export const notFound: RequestHandler = (_request, _response, next) => {
  next(
    new ProblemError({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not found',
      detail: 'The requested resource was not found.',
    }),
  )
}
