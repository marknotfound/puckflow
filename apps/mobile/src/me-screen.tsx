import { ApiProblemError, createApiClient } from '@puckflow/api-client'
import type { Me } from '@puckflow/core'
import { uiTokens } from '@puckflow/ui-tokens'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from 'react-native'

type MeScreenProps = {
  isLoaded: boolean
  isSignedIn: boolean | undefined
  getToken: () => Promise<string | null>
  baseUrl: string
  fetch?: typeof globalThis.fetch
  onSignIn: () => void
}

type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; me: Me }
  | { status: 'error'; detail: string; requestId?: string }

export function MeScreen({
  isLoaded,
  isSignedIn,
  getToken,
  baseUrl,
  fetch,
  onSignIn,
}: MeScreenProps) {
  const colorScheme = useColorScheme()
  const colors = uiTokens.color[colorScheme === 'dark' ? 'dark' : 'light']
  const [profile, setProfile] = useState<ProfileState>({ status: 'loading' })
  const client = useMemo(
    () =>
      createApiClient({
        baseUrl,
        getToken,
        ...(fetch ? { fetch } : {}),
      }),
    [baseUrl, fetch, getToken],
  )

  const loadProfile = useCallback(async () => {
    setProfile({ status: 'loading' })
    try {
      setProfile({ status: 'ready', me: await client.getMe() })
    } catch (error) {
      if (error instanceof ApiProblemError) {
        setProfile(
          error.requestId
            ? {
                status: 'error',
                detail: error.message,
                requestId: error.requestId,
              }
            : { status: 'error', detail: error.message },
        )
      } else {
        setProfile({
          status: 'error',
          detail: 'Your profile is temporarily unavailable.',
        })
      }
    }
  }, [client])

  useEffect(() => {
    if (isLoaded && isSignedIn) void loadProfile()
  }, [isLoaded, isSignedIn, loadProfile])

  if (!isLoaded || isSignedIn === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator
          accessibilityLabel="Loading profile"
          color={colors.accent}
          size="large"
        />
      </View>
    )
  }

  if (!isSignedIn) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: uiTokens.spacing.xl,
          gap: uiTokens.spacing.lg,
        }}
      >
        <Text
          allowFontScaling
          selectable
          style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}
        >
          Sign in to see your PuckFlow profile.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          onPress={onSignIn}
          style={({ pressed }) => ({
            minHeight: uiTokens.mobile.minimumTarget,
            minWidth: uiTokens.mobile.minimumTarget,
            justifyContent: 'center',
            paddingHorizontal: uiTokens.spacing.xl,
            borderRadius: 12,
            backgroundColor: colors.accent,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Text
            allowFontScaling
            style={{ color: colors.surface, fontWeight: '700' }}
          >
            Sign in
          </Text>
        </Pressable>
      </ScrollView>
    )
  }

  if (profile.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator
          accessibilityLabel="Loading profile"
          color={colors.accent}
          size="large"
        />
      </View>
    )
  }

  if (profile.status === 'error') {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: uiTokens.spacing.xl,
          gap: uiTokens.spacing.lg,
        }}
      >
        <View accessibilityRole="alert" style={{ gap: uiTokens.spacing.sm }}>
          <Text
            allowFontScaling
            selectable
            style={{ color: colors.danger, fontSize: 22, fontWeight: '700' }}
          >
            Profile unavailable
          </Text>
          <Text allowFontScaling selectable style={{ color: colors.text }}>
            {profile.detail}
          </Text>
          {profile.requestId ? (
            <Text allowFontScaling selectable style={{ color: colors.text }}>
              Request ID: {profile.requestId}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry profile"
          onPress={() => void loadProfile()}
          style={({ pressed }) => ({
            minHeight: uiTokens.mobile.minimumTarget,
            minWidth: uiTokens.mobile.minimumTarget,
            alignSelf: 'flex-start',
            justifyContent: 'center',
            paddingHorizontal: uiTokens.spacing.xl,
            borderRadius: 12,
            backgroundColor: colors.accent,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Text
            allowFontScaling
            style={{ color: colors.surface, fontWeight: '700' }}
          >
            Retry
          </Text>
        </Pressable>
      </ScrollView>
    )
  }

  const { me } = profile
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        padding: uiTokens.spacing.xl,
        gap: uiTokens.spacing.md,
      }}
    >
      {me.avatarUrl ? (
        <Image
          accessibilityLabel={`${me.displayName} avatar`}
          source={{ uri: me.avatarUrl }}
          style={{ width: 88, height: 88, borderRadius: 44 }}
        />
      ) : null}
      <Text allowFontScaling selectable style={{ color: colors.text }}>
        Signed in as
      </Text>
      <Text
        accessibilityRole="header"
        allowFontScaling
        selectable
        style={{ color: colors.text, fontSize: 28, fontWeight: '700' }}
      >
        {me.displayName}
      </Text>
      <Text allowFontScaling selectable style={{ color: colors.text }}>
        {me.email}
      </Text>
      <Text allowFontScaling selectable style={{ color: colors.text }}>
        Internal user ID
      </Text>
      <Text
        allowFontScaling
        selectable
        style={{ color: colors.text, fontFamily: 'monospace' }}
      >
        {me.id}
      </Text>
    </ScrollView>
  )
}
