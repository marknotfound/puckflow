import { sql } from 'drizzle-orm'

import type { Database } from '../client.js'

export type ClaimedJob = {
  id: string
  category: string
  deterministicKey: string
  payload: Record<string, unknown>
  attemptCount: number
  maxAttempts: number
}

export async function claimJobs(
  database: Database,
  input: { workerId: string; now: Date; limit: number },
): Promise<ClaimedJob[]> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error('Job claim limit must be an integer from 1 through 100')
  }
  const now = sql.param(input.now, jobsTimestampEncoder)

  const rows = await database.execute<ClaimedJob>(sql`
    WITH candidates AS (
      SELECT id
      FROM jobs
      WHERE status = 'pending'
        AND due_at <= ${now}
        AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at, due_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT ${input.limit}
    )
    UPDATE jobs
    SET status = 'claimed',
        attempt_count = jobs.attempt_count + 1,
        claimed_at = ${now},
        claimed_by = ${input.workerId},
        updated_at = ${now}
    FROM candidates
    WHERE jobs.id = candidates.id
    RETURNING jobs.id,
              jobs.category,
              jobs.deterministic_key AS "deterministicKey",
              jobs.payload,
              jobs.attempt_count AS "attemptCount",
              jobs.max_attempts AS "maxAttempts"
  `)

  return [...rows]
}

export async function completeJob(
  database: Database,
  input: { jobId: string; workerId: string; now: Date },
): Promise<boolean> {
  const now = sql.param(input.now, jobsTimestampEncoder)
  const rows = await database.execute<{ id: string }>(sql`
    UPDATE jobs
    SET status = 'completed',
        completed_at = COALESCE(completed_at, (${now})::timestamptz),
        updated_at = CASE
          WHEN status = 'claimed' THEN (${now})::timestamptz
          ELSE updated_at
        END
    WHERE id = ${input.jobId}
      AND claimed_by = ${input.workerId}
      AND status IN ('claimed', 'completed')
    RETURNING id
  `)
  return rows.length === 1
}

export type FailJobInput = {
  jobId: string
  workerId: string
  now: Date
  errorName: string
  errorCode: string
}

export async function failJob(
  database: Database,
  input: FailJobInput,
): Promise<'pending' | 'dead_letter' | null> {
  const sanitizedError = `${sanitizeErrorPart(input.errorName, 'Error')}: ${sanitizeErrorPart(
    input.errorCode,
    'unknown_error',
  )}`
  const now = sql.param(input.now, jobsTimestampEncoder)
  const rows = await database.execute<{
    status: 'pending' | 'dead_letter'
  }>(sql`
    UPDATE jobs
    SET status = CASE
          WHEN attempt_count >= max_attempts THEN 'dead_letter'::job_status
          ELSE 'pending'::job_status
        END,
        next_attempt_at = CASE
          WHEN attempt_count >= max_attempts THEN next_attempt_at
          ELSE (${now})::timestamptz
            + LEAST(300, POWER(2, attempt_count)) * interval '1 second'
        END,
        claimed_at = NULL,
        claimed_by = NULL,
        dead_lettered_at = CASE
          WHEN attempt_count >= max_attempts THEN (${now})::timestamptz
          ELSE NULL
        END,
        last_error = ${sanitizedError},
        updated_at = (${now})::timestamptz
    WHERE id = ${input.jobId}
      AND status = 'claimed'
      AND claimed_by = ${input.workerId}
    RETURNING status
  `)
  return rows[0]?.status ?? null
}

function sanitizeErrorPart(value: string, fallback: string): string {
  return /^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(value) ? value : fallback
}

const jobsTimestampEncoder = {
  mapToDriverValue(value: Date): string {
    return value.toISOString()
  },
}
