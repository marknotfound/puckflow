import type { ExtractTablesWithRelations } from 'drizzle-orm'
import {
  drizzle,
  type PostgresJsDatabase,
  type PostgresJsQueryResultHKT,
} from 'drizzle-orm/postgres-js'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import postgres from 'postgres'

import * as schema from './schema/index.js'

export type Database = PostgresJsDatabase<typeof schema>
export type DbTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

const clients = new WeakMap<Database, postgres.Sql>()

export function createDatabase(url: string): Database {
  const client = postgres(url, { prepare: false })
  const database = drizzle(client, { schema })
  clients.set(database, client)
  return database
}

export async function closeDatabase(
  database: Database,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const client = clients.get(database)
  if (client) {
    clients.delete(database)
    await client.end(
      options.timeoutMs === undefined
        ? undefined
        : { timeout: Math.max(1, options.timeoutMs) / 1_000 },
    )
  }
}
