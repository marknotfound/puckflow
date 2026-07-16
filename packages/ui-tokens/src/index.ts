const lightColors = Object.freeze({
  background: '#F7F8FA',
  surface: '#FFFFFF',
  text: '#0B1220',
  accent: '#1769E0',
  danger: '#B42318',
} as const)

const darkColors = Object.freeze({
  background: '#0B1220',
  surface: '#111B2E',
  text: '#F7F8FA',
  accent: '#69A7FF',
  danger: '#FF8A80',
} as const)

export const uiTokens = Object.freeze({
  color: Object.freeze({
    light: lightColors,
    dark: darkColors,
  }),
  spacing: Object.freeze({
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  } as const),
  mobile: Object.freeze({
    minimumTarget: 44,
  } as const),
})
