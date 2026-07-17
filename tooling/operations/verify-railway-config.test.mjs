import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyRailwayConfig } from './verify-railway-config.mjs'

test('validates current Railway service contracts and migration ownership', () => {
  assert.deepEqual(verifyRailwayConfig(), {
    services: ['api', 'worker', 'cron'],
    productionImageUser: {
      status: 'accepted-platform-deviation',
      railpackVersion: '0.31.1',
      upstreamIssue: 'https://github.com/railwayapp/railpack/issues/286',
      upstreamPullRequest: 'https://github.com/railwayapp/railpack/pull/547',
    },
  })
})
