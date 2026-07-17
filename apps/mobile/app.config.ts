import type { ConfigContext, ExpoConfig } from 'expo/config'

type PublicConfigEnv = {
  NODE_ENV?: string
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?: string
  EXPO_PUBLIC_API_URL?: string
}

function requirePublic(
  env: PublicConfigEnv,
  name: 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY' | 'EXPO_PUBLIC_API_URL',
): string {
  const value = env[name]
  if (!value && env.NODE_ENV !== 'test') {
    throw new Error(`${name} is required`)
  }
  return value ?? ''
}

export function createExpoConfig(
  { config }: ConfigContext,
  env: PublicConfigEnv,
): ExpoConfig {
  requirePublic(env, 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY')
  requirePublic(env, 'EXPO_PUBLIC_API_URL')

  return {
    ...config,
    name: 'PuckFlow',
    slug: 'puckflow',
    version: '0.0.1',
    platforms: ['ios', 'android'],
    orientation: 'default',
    scheme: 'puckflow',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'app.puckflow.mobile',
      supportsTablet: true,
    },
    android: {
      package: 'app.puckflow.mobile',
    },
    plugins: ['expo-router', 'expo-secure-store', '@clerk/expo'],
  }
}

export default (context: ConfigContext): ExpoConfig =>
  createExpoConfig(context, {
    NODE_ENV: process.env.NODE_ENV,
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env
      .EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY as string | undefined,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL as string | undefined,
  })
