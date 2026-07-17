import '../sentry.config'

import { ClerkProvider } from '@clerk/expo'
import * as Sentry from '@sentry/react-native'
import { Stack, ThemeProvider } from 'expo-router'
import { useColorScheme } from 'react-native'

import { getMobileTheme } from '../src/mobile-theme'
import { tokenCache } from '../src/token-cache'

const configuredPublishableKey = process.env
  .EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY as string | undefined
if (!configuredPublishableKey) {
  throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required')
}
const publishableKey: string = configuredPublishableKey

function RootLayout() {
  const theme = getMobileTheme(useColorScheme())

  return (
    <ThemeProvider value={theme}>
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: theme.colors.background },
            headerStyle: { backgroundColor: theme.colors.card },
            headerTintColor: theme.colors.text,
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Profile' }} />
        </Stack>
      </ClerkProvider>
    </ThemeProvider>
  )
}

export default Sentry.wrap(RootLayout)
