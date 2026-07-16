import { z } from 'zod'

export const ProblemCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'OWNER_REQUIRED',
  'PLAYER_LINK_CONFLICT',
  'GOAL_DETAIL_EXCEEDS_FINAL_SCORE',
  'RATE_LIMITED',
  'INTERNAL',
])

export type ProblemCode = z.infer<typeof ProblemCodeSchema>

export const ValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string(),
})

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>

export const ProblemDetailsSchema = z.object({
  type: z.url(),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  code: ProblemCodeSchema,
  requestId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  instance: z.string().min(1),
  errors: z.array(ValidationIssueSchema).optional(),
})

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>
