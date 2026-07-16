import { z } from 'zod'

import { UuidSchema } from '../ids.js'

export const MeSchema = z.object({
  id: UuidSchema,
  email: z.email(),
  displayName: z.string().trim().min(1).max(120),
  avatarUrl: z.url().nullable(),
})

export type Me = z.infer<typeof MeSchema>
