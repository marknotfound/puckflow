import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyRailwayConfig } from './verify-railway-config.mjs'

test('validates current Railway service contracts and migration ownership', () => {
  assert.deepEqual(verifyRailwayConfig(), ['api', 'worker', 'cron'])
})
