import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const readJson = (path) => JSON.parse(read(path))

const workspaceNames = [
  '@puckflow/api',
  '@puckflow/web',
  '@puckflow/mobile',
  '@puckflow/worker',
  '@puckflow/cron',
  '@puckflow/core',
  '@puckflow/db',
  '@puckflow/api-client',
  '@puckflow/ui-tokens',
]

test('pins the repository toolchain', () => {
  assert.equal(read('.node-version').trim(), '24.18.0')

  const manifest = readJson('package.json')
  assert.equal(manifest.packageManager, 'pnpm@11.13.0')
  assert.deepEqual(manifest.engines, { node: '24.18.0', pnpm: '11.13.0' })

  for (const [dependency, version] of Object.entries(
    manifest.devDependencies,
  )) {
    assert.match(
      version,
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `root must pin ${dependency} exactly`,
    )
  }
})

test('declares the complete workspace and root script contract', () => {
  assert.equal(
    read('pnpm-workspace.yaml'),
    "packages:\n  - 'apps/*'\n  - 'packages/*'\nallowBuilds:\n  '@sentry/cli': true\n  browser-tabs-lock: false\n  bufferutil: false\n  core-js: false\n  cpu-features: false\n  esbuild: true\n  protobufjs: false\n  sharp: true\n  ssh2: false\n  unrs-resolver: true\n  utf-8-validate: false\noverrides:\n  '@react-native/jest-preset>@jest/create-cache-key-function': 30.4.1\n  '@react-native/jest-preset>babel-jest': 30.4.1\n  '@react-native/jest-preset>jest-environment-node': 30.4.1\n  'jest-expo>@jest/create-cache-key-function': 30.4.1\n  'jest-expo>@jest/globals': 30.4.1\n  'jest-expo>babel-jest': 30.4.1\n  'jest-expo>jest-environment-jsdom': 30.4.1\n  'jest-expo>jest-snapshot': 30.4.1\n",
  )

  const manifests = ['apps', 'packages'].flatMap((directory) =>
    readdirSync(new URL(directory, root), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readJson(`${directory}/${entry.name}/package.json`)),
  )

  assert.deepEqual(
    manifests.map(({ name }) => name).sort(),
    [...workspaceNames].sort(),
  )
  assert.equal(
    new Set(manifests.map(({ name }) => name)).size,
    workspaceNames.length,
  )

  for (const manifest of manifests) {
    assert.equal(manifest.private, true, `${manifest.name} must be private`)
    assert.equal(manifest.type, 'module', `${manifest.name} must use ESM`)

    const directory = manifest.name.slice('@puckflow/'.length)
    const parent = workspaceNames.slice(0, 5).includes(manifest.name)
      ? 'apps'
      : 'packages'
    assert.equal(
      existsSync(new URL(`${parent}/${directory}/tsconfig.json`, root)),
      true,
      `${manifest.name} must define its TypeScript boundary`,
    )

    for (const dependencyGroup of ['dependencies', 'devDependencies']) {
      for (const [dependency, version] of Object.entries(
        manifest[dependencyGroup] ?? {},
      )) {
        assert.match(
          version,
          /^(?:workspace:\*|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/,
          `${manifest.name} must pin ${dependency} exactly`,
        )
      }
    }
  }

  const rootScripts = readJson('package.json').scripts
  assert.equal(
    rootScripts.postinstall,
    'pnpm --filter @puckflow/api-client build',
  )
  for (const script of [
    'format:check',
    'lint',
    'typecheck',
    'test',
    'test:integration',
    'build',
    'check:mobile',
    'db:up',
    'db:down',
  ]) {
    assert.equal(
      typeof rootScripts[script],
      'string',
      `missing root script ${script}`,
    )
  }
})

test('pins local Postgres and initializes the least-privilege runtime role', () => {
  const compose = read('docker-compose.yml')
  assert.match(compose, /image: postgres:17\.10-alpine3\.24/)
  assert.match(compose, /pg_isready -U postgres -d puckflow/)
  assert.match(
    compose,
    /\.\/tooling\/postgres\/init:\/docker-entrypoint-initdb\.d:ro/,
  )

  const roles = read('tooling/postgres/init/001-roles.sql')
  assert.match(
    roles,
    /CREATE ROLE puckflow_app LOGIN PASSWORD 'puckflow_local'/,
  )
  assert.match(roles, /GRANT CONNECT ON DATABASE puckflow TO puckflow_app/)
  assert.match(roles, /GRANT USAGE ON SCHEMA public TO puckflow_app/)
})

test('leaves application image builds to the later Railway configuration issue', () => {
  for (const directory of ['api', 'web', 'mobile', 'worker', 'cron']) {
    assert.equal(
      existsSync(new URL(`apps/${directory}/Dockerfile`, root)),
      false,
      `${directory} must not define a Dockerfile`,
    )
  }
})

test('records the accepted Expo SDK 57 mutable-registry deviation', () => {
  const deviationPath = 'docs/operations/expo-sdk-57-registry-deviation.md'
  assert.equal(existsSync(new URL(deviationPath, root)), true)
  const deviation = read(deviationPath)

  for (const required of [
    'Reviewed: `2026-07-17`',
    'Status: `accepted-version-ledger-deviation`',
    'Online result: **FAIL (exit 1)**',
    '`expo@57.0.4` | `~57.0.6`',
    '`expo-linking@57.0.2` | `~57.0.3`',
    '`expo-router@57.0.4` | `~57.0.6`',
    '`expo-secure-store@57.0.0` | `~57.0.1`',
    '`expo-system-ui@57.0.0` | `~57.0.1`',
    '`@types/jest@30.0.0` | `29.5.14`',
    '`jest@30.4.2` | `~29.7.0`',
    '`jest-expo@57.0.1` | `~57.0.2`',
    'Owner: repository owner / mobile platform operations',
    '## Compatibility evidence',
    '## Impact and compensating controls',
    'Revisit trigger:',
    '## Exact resolution check',
    'expo install --check',
    'Do not report this command as passing while this deviation is active.',
  ]) {
    assert.equal(
      deviation.includes(required),
      true,
      `Expo registry deviation must contain ${required}`,
    )
  }
})
