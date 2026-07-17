import * as Sentry from '@sentry/react-native'

Sentry.init({
  dsn: (process.env.EXPO_PUBLIC_SENTRY_DSN as string | undefined) || undefined,
  sendDefaultPii: false,
})
