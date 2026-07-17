import { ApiProblemError, createApiClient } from '@puckflow/api-client'
import type { Me } from '@puckflow/core'
import { auth } from '@clerk/nextjs/server'

import type { MeCardError, MeCardResult } from './me-card.js'

export async function getMeForSession(): Promise<Me> {
  const baseUrl = process.env.API_INTERNAL_URL
  if (!baseUrl) throw new Error('API_INTERNAL_URL is required')

  const { getToken } = await auth()
  return createApiClient({ baseUrl, getToken }).getMe()
}

export async function getMeResultForSession(): Promise<MeCardResult> {
  try {
    return { ok: true, me: await getMeForSession() }
  } catch (error) {
    return { ok: false, error: toMeCardError(error) }
  }
}

export function toMeCardError(error: unknown): MeCardError {
  if (error instanceof ApiProblemError) {
    return error.requestId
      ? { detail: error.message, requestId: error.requestId }
      : { detail: error.message }
  }
  return { detail: 'Your profile is temporarily unavailable.' }
}
