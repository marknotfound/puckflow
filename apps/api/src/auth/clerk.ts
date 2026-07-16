import type { User } from '@clerk/backend'
import { createClerkClient } from '@clerk/backend'
import type { ClerkIdentity } from '@puckflow/db'

export type { ClerkIdentity }

export interface IdentityProvider {
  getUser(clerkId: string): Promise<ClerkIdentity>
}

export class IdentityConflictError extends Error {
  constructor() {
    super('A verified primary email address is required.')
    this.name = 'IdentityConflictError'
  }
}

export type ClerkProfile = {
  id: string
  fullName: string | null
  username: string | null
  imageUrl: string
  primaryEmailAddressId: string | null
  emailAddresses: readonly {
    id: string
    emailAddress: string
    verificationStatus: string | undefined
  }[]
}

export function identityFromClerkProfile(profile: ClerkProfile): ClerkIdentity {
  const primaryEmail = profile.emailAddresses.find(
    (email) =>
      email.id === profile.primaryEmailAddressId &&
      email.verificationStatus === 'verified',
  )
  if (!primaryEmail) throw new IdentityConflictError()

  const emailLocalPart = primaryEmail.emailAddress.split('@')[0] ?? ''
  const displayName =
    [profile.fullName, profile.username, emailLocalPart]
      .map((value) => value?.trim() ?? '')
      .find(Boolean)
      ?.slice(0, 120) ?? ''

  return {
    clerkId: profile.id,
    email: primaryEmail.emailAddress,
    displayName,
    clerkImageUrl: profile.imageUrl.trim() || null,
  }
}

function profileFromUser(user: User): ClerkProfile {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    imageUrl: user.imageUrl,
    primaryEmailAddressId: user.primaryEmailAddressId,
    emailAddresses: user.emailAddresses.map((email) => ({
      id: email.id,
      emailAddress: email.emailAddress,
      verificationStatus: email.verification?.status,
    })),
  }
}

export function createClerkIdentityProvider(options: {
  secretKey: string
  publishableKey: string
}): IdentityProvider {
  const client = createClerkClient(options)
  return {
    async getUser(clerkId) {
      const user = await client.users.getUser(clerkId)
      return identityFromClerkProfile(profileFromUser(user))
    },
  }
}
