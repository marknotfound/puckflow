import { useAuth } from '@clerk/expo'
import { AuthView } from '@clerk/expo/native'
import { useEffect, useState } from 'react'
import { Modal, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { MeScreen } from '../src/me-screen'
import { getMobileTheme } from '../src/mobile-theme'

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_URL as string | undefined
if (!configuredBaseUrl) throw new Error('EXPO_PUBLIC_API_URL is required')
const baseUrl: string = configuredBaseUrl

export default function ProfileRoute() {
  const theme = getMobileTheme(useColorScheme())
  const { isLoaded, isSignedIn, getToken } = useAuth({
    treatPendingAsSignedOut: false,
  })
  const [authVisible, setAuthVisible] = useState(true)

  useEffect(() => {
    if (isSignedIn) setAuthVisible(false)
  }, [isSignedIn])

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        edges={['bottom']}
      >
        <MeScreen
          isLoaded={isLoaded}
          isSignedIn={isSignedIn}
          getToken={getToken}
          baseUrl={baseUrl}
          onSignIn={() => setAuthVisible(true)}
        />
      </SafeAreaView>
      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={isLoaded && !isSignedIn && authVisible}
        onRequestClose={() => setAuthVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          <AuthView
            mode="signInOrUp"
            isDismissible
            onDismiss={() => setAuthVisible(false)}
          />
        </View>
      </Modal>
    </View>
  )
}
