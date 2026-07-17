import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const root = new URL('../../', import.meta.url)

const contracts = {
  api: {
    build: 'pnpm --filter @puckflow/api build',
    start: 'node apps/api/dist/server.js',
    health: '/health/ready',
    restart: 'ON_FAILURE',
  },
  worker: {
    build: 'pnpm --filter @puckflow/worker build',
    start: 'node apps/worker/dist/server.js',
    health: '/health/ready',
    restart: 'ON_FAILURE',
  },
  cron: {
    build: 'pnpm --filter @puckflow/cron build',
    start: 'node apps/cron/dist/main.js',
    restart: 'NEVER',
  },
}

export function verifyRailwayConfig() {
  assert.equal(read('.node-version').trim(), '24.18.0')
  const manifest = JSON.parse(read('package.json'))
  assert.equal(manifest.packageManager, 'pnpm@11.13.0')
  assert.deepEqual(manifest.engines, { node: '24.18.0', pnpm: '11.13.0' })

  const services = Object.keys(contracts)
  for (const service of services) {
    const config = read(`apps/${service}/railway.toml`)
    const contract = contracts[service]
    contains(config, 'builder = "RAILPACK"', service)
    contains(config, `buildCommand = "${contract.build}"`, service)
    contains(config, `startCommand = "${contract.start}"`, service)
    contains(config, `restartPolicyType = "${contract.restart}"`, service)
    assert.doesNotMatch(config, /dockerfilePath|postgres\.railway\.internal/i)
    assert.doesNotMatch(config, /(?:password|secret|token)\s*=\s*"[^$]/i)

    if (contract.health) {
      contains(config, `healthcheckPath = "${contract.health}"`, service)
      contains(config, 'healthcheckTimeout = 120', service)
      contains(config, 'restartPolicyMaxRetries = 3', service)
    } else {
      assert.doesNotMatch(config, /healthcheckPath|healthcheckTimeout/)
      assert.doesNotMatch(config, /restartPolicyMaxRetries/)
    }

    if (service === 'api') {
      contains(
        config,
        'preDeployCommand = "pnpm --filter @puckflow/db migrate"',
        service,
      )
    } else {
      assert.doesNotMatch(config, /preDeployCommand/)
    }

    if (service === 'cron') {
      contains(config, 'cronSchedule = "*/5 * * * *"', service)
    } else {
      assert.doesNotMatch(config, /cronSchedule/)
    }
  }

  for (const service of ['api', 'web', 'mobile', 'worker', 'cron']) {
    assert.equal(
      existsSync(new URL(`apps/${service}/Dockerfile`, root)),
      false,
      `${service} must be built by Railpack, not a repository Dockerfile`,
    )
  }

  const productionImageUser = verifyProductionImageUserDeviation()
  return { services, productionImageUser }
}

function verifyProductionImageUserDeviation() {
  const deviation = read('docs/operations/railpack-non-root-deviation.md')
  const expected = {
    status: 'accepted-platform-deviation',
    railpackVersion: '0.31.1',
    upstreamIssue: 'https://github.com/railwayapp/railpack/issues/286',
    upstreamPullRequest: 'https://github.com/railwayapp/railpack/pull/547',
  }
  contains(deviation, `Status: \`${expected.status}\``, 'non-root deviation')
  contains(
    deviation,
    `Railpack version reviewed: \`${expected.railpackVersion}\``,
    'non-root deviation',
  )
  contains(deviation, expected.upstreamIssue, 'non-root deviation')
  contains(deviation, expected.upstreamPullRequest, 'non-root deviation')
  contains(
    deviation,
    'Owner: repository owner / platform operations',
    'non-root deviation',
  )
  contains(deviation, 'Revisit trigger:', 'non-root deviation')
  contains(
    deviation,
    '## Security impact and compensating controls',
    'non-root deviation',
  )
  contains(
    deviation,
    '## Required production verification',
    'non-root deviation',
  )
  contains(deviation, 'It is not full compliance', 'non-root deviation')
  contains(deviation, 'test "$(id -u)" -ne 0', 'non-root deviation')
  return expected
}

function read(path) {
  return readFileSync(new URL(path, root), 'utf8')
}

function contains(config, expected, service) {
  assert.equal(
    config.includes(expected),
    true,
    `${service} Railway config must contain ${expected}`,
  )
}

function isMainModule() {
  const entrypoint = process.argv[1]
  return Boolean(
    entrypoint && import.meta.url === pathToFileURL(entrypoint).href,
  )
}

if (isMainModule()) {
  const result = verifyRailwayConfig()
  process.stdout.write(
    `Railway configuration valid with documented ${result.productionImageUser.status}: ${result.services.join(', ')}\n`,
  )
}
