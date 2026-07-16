import { MeSchema } from '@puckflow/core'
import { Router } from 'express'

import {
  createRequireAuth,
  type AuthAdapter,
  type AuthenticatedRequest,
} from '../auth/require-auth.js'
import type { IdentityProvider } from '../auth/clerk.js'
import type { IdentityUserRepository } from '../auth/provision-user.js'

export function createMeRouter(options: {
  auth: AuthAdapter
  users: IdentityUserRepository
  identityProvider: IdentityProvider
}): Router {
  const router = Router()
  router.get('/me', createRequireAuth(options), (request, response) => {
    const user = (request as AuthenticatedRequest).user
    const me = MeSchema.parse({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.clerkImageUrl,
    })
    response.setHeader('cache-control', 'private, no-store')
    response.status(200).json(me)
  })
  return router
}
