import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'
import { resolve } from 'node:path'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: resolve(import.meta.dirname, '../..'),
  },
}

export default withSentryConfig(nextConfig, {
  ...(process.env.SENTRY_AUTH_TOKEN
    ? { authToken: process.env.SENTRY_AUTH_TOKEN }
    : {}),
  silent: true,
  telemetry: false,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
})
