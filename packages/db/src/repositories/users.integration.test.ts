import { validate, version } from 'uuid'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { createDatabase, closeDatabase, type Database } from '../client.js'
import { migrateDatabase } from '../migrate.js'
import { startTestDatabase, type TestDatabase } from '../testing/database.js'
import { UserRepository } from './users.js'

describe('UserRepository', () => {
  let container: TestDatabase
  let database: Database
  let repository: UserRepository

  beforeAll(async () => {
    container = await startTestDatabase()
    await migrateDatabase(container.adminUrl)
    database = createDatabase(container.runtimeUrl)
    repository = new UserRepository(database)
  }, 120_000)

  beforeEach(async () => {
    await container.reset()
  })

  afterAll(async () => {
    if (database) await closeDatabase(database)
    await container?.stop()
  })

  test('first upsert creates one internally owned UUIDv7 user', async () => {
    const created = await repository.upsertFromClerk({
      clerkId: 'user_avery',
      email: 'avery@example.com',
      displayName: 'Avery Skater',
      clerkImageUrl: null,
    })

    expect(validate(created.id)).toBe(true)
    expect(version(created.id)).toBe(7)
    await expect(repository.findByClerkId('user_avery')).resolves.toEqual(
      created,
    )
  })

  test('repeated upsert updates profile fields without changing internal identity', async () => {
    const original = await repository.upsertFromClerk({
      clerkId: 'user_casey',
      email: 'old@example.com',
      displayName: 'Old Name',
      clerkImageUrl: null,
    })

    const updated = await repository.upsertFromClerk({
      clerkId: 'user_casey',
      email: 'casey@example.com',
      displayName: 'Casey Goalie',
      clerkImageUrl: 'https://img.example.com/casey.png',
    })

    expect(updated.id).toBe(original.id)
    expect(updated).toMatchObject({
      clerkId: 'user_casey',
      email: 'casey@example.com',
      displayName: 'Casey Goalie',
      clerkImageUrl: 'https://img.example.com/casey.png',
      deletedAt: null,
    })
  })

  test('valid authenticated upsert reactivates a soft-deleted user', async () => {
    const original = await repository.upsertFromClerk({
      clerkId: 'user_reactivated',
      email: 'returning@example.com',
      displayName: 'Returning Player',
      clerkImageUrl: null,
    })
    await repository.softDeleteByClerkId('user_reactivated')

    const reactivated = await repository.upsertFromClerk({
      clerkId: 'user_reactivated',
      email: 'returning@example.com',
      displayName: 'Returning Player',
      clerkImageUrl: null,
    })

    expect(reactivated.id).toBe(original.id)
    expect(reactivated.deletedAt).toBeNull()
  })
})
