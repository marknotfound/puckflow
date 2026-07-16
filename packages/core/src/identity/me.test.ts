import { describe, expect, it } from 'vitest'

import { MeSchema } from './me.js'

const me = {
  id: '019c4ab8-ef80-7000-8000-000000000001',
  email: 'skater@example.com',
  displayName: 'Avery Skater',
  avatarUrl: null,
} as const

describe('MeSchema', () => {
  it('accepts the signed-in user projection', () => {
    expect(MeSchema.parse(me)).toEqual(me)
  })

  it('rejects a non-UUID internal user ID', () => {
    expect(() => MeSchema.parse({ ...me, id: 'clerk-user-id' })).toThrow()
  })

  it('rejects an empty display name after trimming', () => {
    expect(() => MeSchema.parse({ ...me, displayName: '   ' })).toThrow()
  })
})
