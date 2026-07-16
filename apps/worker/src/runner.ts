import { claimJobs, completeJob, failJob, type Database } from '@puckflow/db'

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
}

export type JobHandler = (input: JobHandlerInput) => Promise<void>

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

  for (const job of claimed) {
    const handler = dependencies.handlers[job.category]
    try {
      if (!handler) throw unknownCategory(job.category)
      await handler({
        jobId: job.id,
        deterministicKey: job.deterministicKey,
        payload: job.payload,
      })
      const completed = await completeJob(dependencies.database, {
        jobId: job.id,
        workerId: dependencies.workerId,
        now: dependencies.now,
      })
      if (!completed) throw jobCompletionFailure()
      result.completedCount += 1
    } catch (error) {
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
      dependencies.sentry.captureException(error, {
        jobId: job.id,
        category: job.category,
      })
    }
  }

  return result
}

function unknownCategory(category: string): Error & { code: string } {
  return Object.assign(new Error('Unsupported job category'), {
    name: 'UnknownJobCategory',
    code: category,
  })
}

function jobCompletionFailure(): Error & { code: string } {
  return Object.assign(new Error('Claimed job could not be completed'), {
    name: 'JobCompletionError',
    code: 'claim_lost',
  })
}

function safeErrorIdentity(error: unknown): {
  errorName: string
  errorCode: string
} {
  if (typeof error !== 'object' || error === null) {
    return { errorName: 'Error', errorCode: 'unknown_error' }
  }
  const candidate = error as { name?: unknown; code?: unknown }
  return {
    errorName: typeof candidate.name === 'string' ? candidate.name : 'Error',
    errorCode:
      typeof candidate.code === 'string' ? candidate.code : 'unknown_error',
  }
}
