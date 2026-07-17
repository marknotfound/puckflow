import { uiTokens } from '@puckflow/ui-tokens'

import { getMobileTheme } from './mobile-theme'

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    )
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('mobile navigation theme', () => {
  it.each([
    ['light', false, uiTokens.color.light],
    ['dark', true, uiTokens.color.dark],
  ] as const)(
    'maps the %s system scheme to navigation and semantic containers',
    (scheme, dark, colors) => {
      const theme = getMobileTheme(scheme)

      expect(theme.dark).toBe(dark)
      expect(theme.colors).toMatchObject({
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        primary: colors.accent,
        notification: colors.danger,
      })
    },
  )

  it.each([uiTokens.color.light, uiTokens.color.dark])(
    'keeps semantic text readable on the container background',
    (colors) => {
      expect(
        contrastRatio(colors.text, colors.background),
      ).toBeGreaterThanOrEqual(4.5)
    },
  )
})
