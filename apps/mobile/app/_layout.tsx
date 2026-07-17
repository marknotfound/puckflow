import '../sentry.config'

import { ClerkProvider } from '@clerk/expo'
import * as Sentry from '@sentry/react-native'
import { Stack } from 'expo-router'

import { tokenCache } from '../src/token-cache'

function requirePublicEnv(name: string): string {
  const value = process.env[name] as string | undefined
  if (!value) throw new Error(`${name} is required`)
  return value
}

const publishableKey = requirePublicEnv('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY')

function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Profile' }} />
      </Stack>
    </ClerkProvider>
  )
}

export default Sentry.wrap(RootLayout)
