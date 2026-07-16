import { and, eq, isNull } from 'drizzle-orm'

import type { Database, DbTransaction } from '../client.js'
import { generateId } from '../ids.js'
import { users, type User } from '../schema/users.js'

export type ClerkIdentity = {
  clerkId: string
  email: string
  displayName: string
  clerkImageUrl: string | null
}

export class UserRepository {
  constructor(private readonly database: Database | DbTransaction) {}

  async findByClerkId(clerkId: string): Promise<User | null> {
    const [user] = await this.database
      .select()
      .from(users)
      .where(and(eq(users.clerkId, clerkId), isNull(users.deletedAt)))
      .limit(1)
    return user ?? null
  }

  async upsertFromClerk(input: ClerkIdentity): Promise<User> {
    const [user] = await this.database
      .insert(users)
      .values({
        id: generateId(),
        clerkId: input.clerkId,
        email: input.email,
        displayName: input.displayName,
        clerkImageUrl: input.clerkImageUrl,
      })
      .onConflictDoUpdate({
        target: users.clerkId,
        set: {
          email: input.email,
          displayName: input.displayName,
          clerkImageUrl: input.clerkImageUrl,
          deletedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning()

    if (!user) throw new Error('User upsert did not return a row')
    return user
  }

  async softDeleteByClerkId(clerkId: string): Promise<User | null> {
    const now = new Date()
    const [user] = await this.database
      .update(users)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(users.clerkId, clerkId), isNull(users.deletedAt)))
      .returning()
    return user ?? null
  }
}
