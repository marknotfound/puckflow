import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.MIGRATION_DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:5432/puckflow',
  },
  strict: true,
  verbose: true,
})
