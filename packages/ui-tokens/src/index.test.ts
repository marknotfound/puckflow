import { describe, expect, it } from 'vitest'

import { uiTokens } from './index.js'

describe('uiTokens', () => {
  it('provides the approved semantic colors, spacing, and mobile target', () => {
    expect(uiTokens).toEqual({
      color: {
        light: {
          background: '#F7F8FA',
          surface: '#FFFFFF',
          text: '#0B1220',
          accent: '#1769E0',
          danger: '#B42318',
        },
        dark: {
          background: '#0B1220',
          surface: '#111B2E',
          text: '#F7F8FA',
          accent: '#69A7FF',
          danger: '#FF8A80',
        },
      },
      spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
      mobile: { minimumTarget: 44 },
    })
  })

  it('cannot be mutated at runtime', () => {
    expect(Object.isFrozen(uiTokens)).toBe(true)
    expect(Object.isFrozen(uiTokens.color)).toBe(true)
    expect(Object.isFrozen(uiTokens.color.light)).toBe(true)
    expect(Object.isFrozen(uiTokens.color.dark)).toBe(true)
    expect(Object.isFrozen(uiTokens.spacing)).toBe(true)
    expect(Object.isFrozen(uiTokens.mobile)).toBe(true)
  })
})
