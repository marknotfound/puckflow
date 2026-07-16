import type { JobHandler, WorkerLogger } from './runner.js'

export function createJobHandlers(
  logger: WorkerLogger,
): Record<string, JobHandler> {
  return {
    'system.smoke': ({ jobId }) => {
      logger.info({ jobId }, 'system smoke job handled')
      return Promise.resolve()
    },
  }
}
