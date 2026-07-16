import { describe, expect, test } from 'vitest'

import { IdentityConflictError, identityFromClerkProfile } from './clerk.js'

describe('identityFromClerkProfile', () => {
  test('selects the verified primary email and trims the full name', () => {
    expect(
      identityFromClerkProfile({
        id: 'user_avery',
        fullName: '  Avery Skater  ',
        username: 'avery',
        imageUrl: 'https://img.example.com/avery.png',
        primaryEmailAddressId: 'email_primary',
        emailAddresses: [
          {
            id: 'email_secondary',
            emailAddress: 'other@example.com',
            verificationStatus: 'verified',
          },
          {
            id: 'email_primary',
            emailAddress: 'avery@example.com',
            verificationStatus: 'verified',
          },
        ],
      }),
    ).toEqual({
      clerkId: 'user_avery',
      email: 'avery@example.com',
      displayName: 'Avery Skater',
      clerkImageUrl: 'https://img.example.com/avery.png',
    })
  })

  test('falls back from blank full name to username then email local part', () => {
    const base = {
      id: 'user_goalie',
      fullName: ' ',
      imageUrl: '',
      primaryEmailAddressId: 'email_primary',
      emailAddresses: [
        {
          id: 'email_primary',
          emailAddress: 'goalie@example.com',
          verificationStatus: 'verified',
        },
      ],
    }

    expect(
      identityFromClerkProfile({ ...base, username: ' crease_guardian ' })
        .displayName,
    ).toBe('crease_guardian')
    expect(
      identityFromClerkProfile({ ...base, username: null }).displayName,
    ).toBe('goalie')
  })

  test('rejects a missing or unverified primary email', () => {
    expect(() =>
      identityFromClerkProfile({
        id: 'user_unverified',
        fullName: 'Unverified',
        username: null,
        imageUrl: '',
        primaryEmailAddressId: 'email_primary',
        emailAddresses: [
          {
            id: 'email_primary',
            emailAddress: 'unverified@example.com',
            verificationStatus: 'unverified',
          },
        ],
      }),
    ).toThrow(IdentityConflictError)
  })
})
