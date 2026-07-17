import { MeCard } from '../src/me-card.js'
import { getMeResultForSession } from '../src/server-me.js'

export const dynamic = 'force-dynamic'

export async function refreshMe() {
  'use server'
  return getMeResultForSession()
}

export default async function HomePage() {
  const result = await getMeResultForSession()
  return (
    <main>
      <MeCard
        {...(result.ok
          ? { initialMe: result.me }
          : { initialError: result.error })}
        getMe={refreshMe}
      />
    </main>
  )
}
