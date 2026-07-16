import postgres from 'postgres'
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers'

export type TestDatabase = {
  adminUrl: string
  runtimeUrl: string
  reset(): Promise<void>
  stop(): Promise<void>
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedTestContainer = await new GenericContainer(
    'postgres:17.10-alpine3.24',
  )
    .withEnvironment({ POSTGRES_DB: 'puckflow', POSTGRES_PASSWORD: 'postgres' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: ['CMD-SHELL', 'pg_isready -U postgres -d puckflow'],
      interval: 1_000,
      timeout: 5_000,
      retries: 30,
    })
    .start()

  const host = container.getHost()
  const port = container.getMappedPort(5432)
  const adminUrl = `postgresql://postgres:postgres@${host}:${port}/puckflow`
  const runtimeUrl = `postgresql://puckflow_app:puckflow_test@${host}:${port}/puckflow`
  const admin = postgres(adminUrl, { max: 1 })

  await admin.unsafe(`CREATE ROLE puckflow_app LOGIN PASSWORD 'puckflow_test'`)
  await admin.unsafe('GRANT CONNECT ON DATABASE puckflow TO puckflow_app')
  await admin.unsafe('GRANT USAGE ON SCHEMA public TO puckflow_app')
  await admin.end()

  return {
    adminUrl,
    runtimeUrl,
    async reset() {
      const client = postgres(adminUrl, { max: 1 })
      await client.unsafe(`
        TRUNCATE TABLE audit_logs, jobs, outbox_events, webhook_events, users CASCADE
      `)
      await client.end()
    },
    async stop() {
      await container.stop()
    },
  }
}
