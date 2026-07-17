import { DarkTheme, DefaultTheme } from 'expo-router'
import type { ColorSchemeName } from 'react-native'

import { uiTokens } from '@puckflow/ui-tokens'

export function getMobileTheme(colorScheme: ColorSchemeName) {
  const dark = colorScheme === 'dark'
  const baseTheme = dark ? DarkTheme : DefaultTheme
  const colors = uiTokens.color[dark ? 'dark' : 'light']

  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      primary: colors.accent,
      notification: colors.danger,
    },
  }
}
