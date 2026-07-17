import { MeCard } from '../src/me-card.js'
import { getMeForSession, toMeCardError } from '../src/server-me.js'

export const dynamic = 'force-dynamic'

export async function refreshMe() {
  'use server'
  return getMeForSession()
}

export default async function HomePage() {
  try {
    const me = await getMeForSession()
    return (
      <main>
        <MeCard initialMe={me} getMe={refreshMe} />
      </main>
    )
  } catch (error) {
    return (
      <main>
        <MeCard initialError={toMeCardError(error)} getMe={refreshMe} />
      </main>
    )
  }
}
