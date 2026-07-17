import { useAuth } from '@clerk/expo'
import { AuthView } from '@clerk/expo/native'
import { useEffect, useState } from 'react'
import { Modal, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { MeScreen } from '../src/me-screen'

function requirePublicEnv(name: string): string {
  const value = process.env[name] as string | undefined
  if (!value) throw new Error(`${name} is required`)
  return value
}

const baseUrl = requirePublicEnv('EXPO_PUBLIC_API_URL')

export default function ProfileRoute() {
  const { isLoaded, isSignedIn, getToken } = useAuth({
    treatPendingAsSignedOut: false,
  })
  const [authVisible, setAuthVisible] = useState(true)

  useEffect(() => {
    if (isSignedIn) setAuthVisible(false)
  }, [isSignedIn])

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
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
        <AuthView
          mode="signInOrUp"
          isDismissible
          onDismiss={() => setAuthVisible(false)}
        />
      </Modal>
    </View>
  )
}
