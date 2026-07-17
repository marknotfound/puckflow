import { claimJobs, completeJob, failJob, type Database } from '@puckflow/db'

import {
  jobCompletionError,
  safeErrorIdentity,
  sanitizedWorkerException,
  unknownJobCategoryError,
  workerShutdownError,
} from './errors.js'

export interface WorkerLogger {
  info(context: Record<string, unknown>, message: string): void
  error(context: Record<string, unknown>, message: string): void
}

export interface WorkerSentry {
  captureException(
    error: unknown,
    context: { jobId: string; category: string },
  ): void
}

export type JobHandlerInput = {
  jobId: string
  deterministicKey: string
  payload: Record<string, unknown>
  signal: AbortSignal
}

export type JobHandler = (input: JobHandlerInput) => Promise<void>

export type WorkerActivityTracker = {
  track<T>(operation: Promise<T>): Promise<T>
  waitForIdle(): Promise<void>
}

export function createWorkerActivityTracker(): WorkerActivityTracker {
  const pending = new Set<Promise<unknown>>()
  const idleWaiters = new Set<() => void>()
  return {
    track<T>(operation: Promise<T>): Promise<T> {
      const tracked = Promise.resolve(operation)
      pending.add(tracked)
      const markSettled = () => {
        pending.delete(tracked)
        if (pending.size === 0) {
          for (const resolve of idleWaiters) resolve()
          idleWaiters.clear()
        }
      }
      void tracked.then(markSettled, markSettled)
      return tracked
    },
    waitForIdle(): Promise<void> {
      if (pending.size === 0) return Promise.resolve()
      return new Promise((resolve) => idleWaiters.add(resolve))
    },
  }
}

export type WorkerIterationResult = {
  claimedCount: number
  completedCount: number
  retriedCount: number
  deadLetteredCount: number
}

export type WorkerIterationDependencies = {
  database: Database
  workerId: string
  now: Date
  batchSize: number
  handlers: Readonly<Record<string, JobHandler>>
  logger: WorkerLogger
  sentry: WorkerSentry
  signal: AbortSignal
  activity?: WorkerActivityTracker
}

export async function runWorkerIteration(
  dependencies: WorkerIterationDependencies,
): Promise<WorkerIterationResult> {
  const claimed = await claimJobs(dependencies.database, {
    workerId: dependencies.workerId,
    now: dependencies.now,
    limit: dependencies.batchSize,
  })
  const result: WorkerIterationResult = {
    claimedCount: claimed.length,
    completedCount: 0,
    retriedCount: 0,
    deadLetteredCount: 0,
  }
  const activity = dependencies.activity ?? createWorkerActivityTracker()

  for (const job of claimed) {
    const handler = dependencies.handlers[job.category]
    if (dependencies.signal.aborted) {
      await recordFailure(
        dependencies,
        job,
        workerShutdownError(),
        false,
        result,
      )
      continue
    }
    try {
      if (!handler) throw unknownJobCategoryError()
      await runWithAbort(
        handler({
          jobId: job.id,
          deterministicKey: job.deterministicKey,
          payload: job.payload,
          signal: dependencies.signal,
        }),
        dependencies.signal,
        activity,
      )
      const completed = await completeJob(dependencies.database, {
        jobId: job.id,
        workerId: dependencies.workerId,
        now: dependencies.now,
      })
      if (!completed) throw jobCompletionError()
      result.completedCount += 1
    } catch (error) {
      await recordFailure(
        dependencies,
        job,
        error,
        !dependencies.signal.aborted,
        result,
      )
    }
  }

  return result
}

async function recordFailure(
  dependencies: WorkerIterationDependencies,
  job: { id: string; category: string },
  error: unknown,
  captureException: boolean,
  result: WorkerIterationResult,
): Promise<void> {
  const { errorName, errorCode } = safeErrorIdentity(error)
  const status = await failJob(dependencies.database, {
    jobId: job.id,
    workerId: dependencies.workerId,
    now: dependencies.now,
    errorName,
    errorCode,
  })
  if (status === 'pending') result.retriedCount += 1
  if (status === 'dead_letter') result.deadLetteredCount += 1
  dependencies.logger.error(
    {
      jobId: job.id,
      category: job.category,
      status,
      errorName,
      errorCode,
    },
    'job failed',
  )
  if (captureException) {
    dependencies.sentry.captureException(sanitizedWorkerException(error), {
      jobId: job.id,
      category: job.category,
    })
  }
}

function runWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  activity: WorkerActivityTracker,
): Promise<T> {
  const trackedOperation = activity.track(operation)
  if (signal.aborted) return Promise.reject(workerShutdownError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(workerShutdownError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void trackedOperation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(sanitizedWorkerException(error))
      },
    )
  })
}
