import type { ClerkIdentity, User } from '@puckflow/db'

import { ProblemError } from '../http/problem.js'
import { IdentityConflictError, type IdentityProvider } from './clerk.js'

export interface IdentityUserRepository {
  findByClerkId(clerkId: string): Promise<User | null>
  upsertFromClerk(input: ClerkIdentity): Promise<User>
}

export async function provisionUser(options: {
  clerkId: string
  users: IdentityUserRepository
  identityProvider: IdentityProvider
}): Promise<User> {
  const existing = await options.users.findByClerkId(options.clerkId)
  if (existing) return existing

  let identity: ClerkIdentity
  try {
    identity = await options.identityProvider.getUser(options.clerkId)
  } catch (cause) {
    if (cause instanceof IdentityConflictError) {
      throw new ProblemError({
        status: 409,
        code: 'CONFLICT',
        title: 'Identity conflict',
        detail: 'A verified primary email address is required.',
        cause,
      })
    }
    throw new ProblemError({
      status: 503,
      code: 'INTERNAL',
      title: 'Identity service unavailable',
      detail: 'Identity service is unavailable.',
      cause,
    })
  }

  if (identity.clerkId !== options.clerkId) {
    throw new ProblemError({
      status: 503,
      code: 'INTERNAL',
      title: 'Identity service unavailable',
      detail: 'Identity service is unavailable.',
    })
  }
  return options.users.upsertFromClerk(identity)
}
