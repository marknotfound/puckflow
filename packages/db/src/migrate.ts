import { fileURLToPath } from 'node:url'

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

async function appliedMigrationCount(
  database: ReturnType<typeof drizzle>,
): Promise<number> {
  const existence = await database.execute<{ exists: boolean }>(sql`
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists
  `)
  if (!existence[0]?.exists) return 0

  const result = await database.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations
  `)
  return Number(result[0]?.count ?? 0)
}

export async function migrateDatabase(url: string): Promise<number> {
  const client = postgres(url, { max: 1, prepare: false })
  const database = drizzle(client)

  try {
    const before = await appliedMigrationCount(database)
    await migrate(database, { migrationsFolder })
    const after = await appliedMigrationCount(database)
    return after - before
  } finally {
    await client.end()
  }
}
