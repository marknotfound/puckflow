import { pathToFileURL } from 'node:url'

import * as Sentry from '@sentry/node'
import { closeDatabase, createDatabase } from '@puckflow/db'
import pino from 'pino'

import { loadCronConfig } from './config.js'
import { runSweep, type SweepResult } from './sweep.js'

export interface CronLogger {
  info(context: Record<string, unknown>, message: string): void
  error(context: Record<string, unknown>, message: string): void
}

export type CronProcessDependencies = {
  runSweep(): Promise<SweepResult>
  closeDatabase(): Promise<void>
  flushSentry(timeoutMs: number): Promise<unknown>
  captureException(error: unknown): void
  logger: CronLogger
}

export async function executeCron(
  dependencies: CronProcessDependencies,
): Promise<0 | 1> {
  let exitCode: 0 | 1 = 0
  try {
    await dependencies.runSweep()
  } catch (error) {
    exitCode = 1
    dependencies.captureException(error)
    dependencies.logger.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      'cron sweep failed',
    )
  }

  try {
    await dependencies.closeDatabase()
  } catch (error) {
    exitCode = 1
    dependencies.captureException(error)
    dependencies.logger.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      'cron database cleanup failed',
    )
  } finally {
    await dependencies.flushSentry(2_000)
  }
  return exitCode
}

async function main(): Promise<0 | 1> {
  const config = loadCronConfig()
  Sentry.init({
    dsn: config.sentryDsn,
    enabled: Boolean(config.sentryDsn),
    environment: config.sentryEnvironment,
    release: config.sentryRelease,
    sendDefaultPii: false,
  })
  const logger = pino({
    level: config.logLevel,
    base: {
      service: 'cron',
      environment: config.sentryEnvironment,
      release: config.sentryRelease,
    },
    redact: {
      paths: ['*.databaseUrl', '*.token', '*.secret', '*.password'],
      censor: '[Redacted]',
    },
  })
  const database = createDatabase(config.databaseUrl)
  return executeCron({
    runSweep: () => runSweep({ database, now: new Date(), logger }),
    closeDatabase: () => closeDatabase(database),
    flushSentry: (timeoutMs) => Sentry.flush(timeoutMs),
    captureException: (error) => Sentry.captureException(error),
    logger,
  })
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1]
  return Boolean(
    entrypoint && import.meta.url === pathToFileURL(entrypoint).href,
  )
}

if (isMainModule()) {
  void main()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch(async () => {
      process.stderr.write('Cron failed to start\n')
      await Sentry.flush(2_000)
      process.exitCode = 1
    })
}
