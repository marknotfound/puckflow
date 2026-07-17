import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repository = new URL('../..', import.meta.url).pathname
const ignoredParts = new Set([
  '.expo',
  '.git',
  '.next',
  '.nvmrc',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
])

function run(cwd, args, environment = {}) {
  const result = spawnSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', ...environment },
  })
  assert.equal(
    result.status,
    0,
    [`pnpm ${args.join(' ')}`, result.stdout, result.stderr].join('\n'),
  )
}

function copyCleanRepository(destination) {
  cpSync(repository, destination, {
    recursive: true,
    filter(source) {
      const path = relative(repository, source)
      if (!path) return true
      return !path.split(sep).some((part) => ignoredParts.has(part))
    },
  })
}

function outputContains(directory, expected) {
  return readdirSync(directory).some((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory()
      ? outputContains(path, expected)
      : readFileSync(path).includes(expected)
  })
}

test('clean Railway and Expo production paths build the shared client first', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'puckflow-clean-deploy-'))
  const copy = join(fixture, basename(repository))

  try {
    copyCleanRepository(copy)
    assert.equal(existsSync(join(copy, 'packages/api-client/dist')), false)

    run(copy, ['install', '--frozen-lockfile'])
    assert.equal(
      existsSync(join(copy, 'packages/api-client/dist/index.js')),
      true,
      'the clean install lifecycle must build @puckflow/api-client',
    )

    run(copy, ['--filter', '@puckflow/web', 'build'], {
      API_INTERNAL_URL: 'http://127.0.0.1:3000',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_clean_deploy',
      NEXT_PUBLIC_SENTRY_DSN: '',
      NEXT_TELEMETRY_DISABLED: '1',
    })

    const expoOutput = join(copy, '.expo-production-export')
    const publicBuildValues = {
      EXPO_PUBLIC_API_URL: 'https://clean-deploy-api.example.test',
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_clean_deploy_bundle',
      EXPO_PUBLIC_SENTRY_DSN:
        'https://clean-deploy-public@example.ingest.sentry.io/17',
      NODE_ENV: 'production',
    }
    run(
      copy,
      [
        '--filter',
        '@puckflow/mobile',
        'exec',
        'expo',
        'export',
        '--platform',
        'ios',
        '--output-dir',
        expoOutput,
        '--clear',
      ],
      publicBuildValues,
    )
    for (const value of Object.values(publicBuildValues).filter(
      (value) => value !== 'production',
    )) {
      assert.equal(
        outputContains(expoOutput, value),
        true,
        `production Expo output must contain statically inlined ${value}`,
      )
    }
  } finally {
    rmSync(fixture, { force: true, recursive: true })
  }
})
