import { sql } from 'drizzle-orm'

const worker = await import('../dist/server.js')
const { abortableDelay, runWorkerProcess } = worker
const mode = process.argv[2]

if (
  mode !== 'polling' &&
  mode !== 'production-stuck-handler' &&
  mode !== 'stuck-cleanup'
) {
  throw new Error(`Unknown fixture mode: ${mode}`)
}

if (mode === 'production-stuck-handler') {
  await runProductionStuckHandler()
} else {
  await runGenericFixture(mode)
}

async function runProductionStuckHandler() {
  const {
    closeWorkerDatabase,
    createWorkerActivityTracker,
    openWorkerDatabase,
    runWorkerIteration,
  } = worker
  const database = openWorkerDatabase(process.env.DATABASE_URL)
  const activity = createWorkerActivityTracker()
  await runWorkerProcess({
    signals: process,
    runIteration: (signal) =>
      runWorkerIteration({
        database,
        workerId: `fixture:${process.pid}`,
        now: new Date(process.env.WORKER_NOW),
        batchSize: 1,
        handlers: {
          'system.smoke': () => {
            setInterval(() => undefined, 60_000)
            process.stdout.write('handler-started\n')
            return new Promise(() => undefined)
          },
        },
        logger: { info() {}, error() {} },
        sentry: { captureException() {} },
        signal,
        activity,
      }),
    waitForInFlight: () => activity.waitForIdle(),
    sleep: (signal) => abortableDelay(60_000, signal),
    closeHealthServer: () => {
      process.stdout.write('health-closed\n')
      return Promise.resolve()
    },
    closeDatabase: (timeoutMs) => {
      process.stdout.write('database-closed\n')
      return closeWorkerDatabase(database, timeoutMs)
    },
    flushSentry: () => {
      process.stdout.write('sentry-flushed\n')
      return Promise.resolve(true)
    },
    forceExit(code) {
      process.exit(code)
    },
    shutdownTimeoutMs: 500,
    logger: { info() {}, error() {} },
  })
  process.stdout.write('done\n')
}

async function runGenericFixture(fixtureMode) {
  const stuckCleanup = fixtureMode === 'stuck-cleanup'
  const keepAlive = stuckCleanup
    ? setInterval(() => undefined, 60_000)
    : undefined
  const neverSettles = () => new Promise(() => undefined)
  const cleanupDatabase = stuckCleanup
    ? worker.openWorkerDatabase(process.env.DATABASE_URL)
    : undefined
  if (cleanupDatabase) {
    void cleanupDatabase
      .execute(sql`select pg_sleep(60)`)
      .catch(() => undefined)
    process.stdout.write('pending-query-started\n')
  }

  const running = runWorkerProcess({
    signals: process,
    runIteration: () => Promise.resolve(),
    waitForInFlight: () => Promise.resolve(),
    sleep: (signal) => abortableDelay(60_000, signal),
    closeHealthServer: () => {
      if (keepAlive) clearInterval(keepAlive)
      if (stuckCleanup) {
        process.stdout.write('health-close-attempted\n')
        return neverSettles()
      }
      process.stdout.write('health-closed\n')
      return Promise.resolve()
    },
    closeDatabase: (timeoutMs) => {
      if (stuckCleanup) {
        process.stdout.write('database-close-attempted\n')
        return worker.closeWorkerDatabase(cleanupDatabase, timeoutMs)
      }
      process.stdout.write('database-closed\n')
      return Promise.resolve()
    },
    flushSentry: () => {
      if (stuckCleanup) {
        process.stdout.write('sentry-flush-attempted\n')
        return neverSettles()
      }
      process.stdout.write('sentry-flushed\n')
      return Promise.resolve(true)
    },
    forceExit(code) {
      process.exit(code)
    },
    shutdownTimeoutMs: stuckCleanup ? 500 : 150,
    logger: { info() {}, error() {} },
  })

  setImmediate(() => process.stdout.write('ready\n'))
  await running
  process.stdout.write('done\n')
}
