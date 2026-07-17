import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ConfigContext } from 'expo/config'

import { createExpoConfig } from '../app.config'

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8')

const configContext: ConfigContext = {
  projectRoot: process.cwd(),
  staticConfigPath: null,
  packageJsonPath: null,
  config: {},
}

describe('mobile public configuration', () => {
  it('uses only statically transformable Expo public environment reads', () => {
    const sources = [
      'app.config.ts',
      'app/_layout.tsx',
      'app/index.tsx',
      'sentry.config.ts',
    ].map(read)

    expect(sources.join('\n')).not.toContain('process.env[')
    expect(read('app/_layout.tsx')).toMatch(
      /process\.env\s*\.\s*EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY/,
    )
    expect(read('app/index.tsx')).toMatch(
      /process\.env\s*\.\s*EXPO_PUBLIC_API_URL/,
    )
    expect(read('sentry.config.ts')).toMatch(
      /process\.env\s*\.\s*EXPO_PUBLIC_SENTRY_DSN/,
    )
  })

  it('requires only the public Clerk key and API URL outside tests', () => {
    expect(() =>
      createExpoConfig(configContext, { NODE_ENV: 'production' }),
    ).toThrow('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required')
  })

  it('uses the exact native identifiers without exposing secrets in extra', () => {
    const config = createExpoConfig(configContext, {
      NODE_ENV: 'production',
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_build',
      EXPO_PUBLIC_API_URL: 'https://api.example.test',
    })

    expect(config.platforms).toEqual(['ios', 'android'])
    expect(config.scheme).toBe('puckflow')
    expect(config.ios).toMatchObject({
      bundleIdentifier: 'app.puckflow.mobile',
      supportsTablet: true,
    })
    expect(config.android).toMatchObject({ package: 'app.puckflow.mobile' })
    expect(JSON.stringify(config.extra ?? {})).not.toMatch(/secret|token|sk_/i)
  })

  it('declares only internal development and preview EAS profiles', () => {
    const eas = JSON.parse(read('eas.json')) as {
      cli: { version: string }
      build: Record<string, unknown>
      submit?: unknown
    }
    expect(eas.cli.version).toBe('21.0.0')
    expect(Object.keys(eas.build)).toEqual(['development', 'preview'])
    expect(eas.submit).toBeUndefined()
    expect(read('src/token-cache.ts')).not.toContain('AsyncStorage')
  })
})
