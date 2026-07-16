import type { User } from '@puckflow/db'
import type { Request, RequestHandler } from 'express'

import { ProblemError } from '../http/problem.js'
import { requestContext } from '../request-context.js'
import type { IdentityProvider } from './clerk.js'
import { provisionUser, type IdentityUserRepository } from './provision-user.js'

export type AuthState = {
  isAuthenticated: boolean
  userId: string | null
}

export type AuthAdapter = {
  getAuth(request: Request): AuthState
}

export type AuthenticatedRequest = Request & { user: User }

export function createRequireAuth(options: {
  auth: AuthAdapter
  users: IdentityUserRepository
  identityProvider: IdentityProvider
}): RequestHandler {
  return async (request, response, next) => {
    try {
      const auth = options.auth.getAuth(request)
      if (!auth.isAuthenticated || !auth.userId) {
        throw new ProblemError({
          status: 401,
          code: 'UNAUTHENTICATED',
          title: 'Authentication required',
          detail: 'Sign in to continue.',
        })
      }

      const user = await provisionUser({
        clerkId: auth.userId,
        users: options.users,
        identityProvider: options.identityProvider,
      })
      ;(request as AuthenticatedRequest).user = user
      requestContext(response).user = { id: user.id, clerkId: user.clerkId }
      next()
    } catch (error) {
      next(error)
    }
  }
}
