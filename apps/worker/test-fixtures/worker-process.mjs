import { abortableDelay, runWorkerProcess } from '../dist/server.js'

const mode = process.argv[2]
const keepAlive =
  mode === 'stuck-handler' ? setInterval(() => undefined, 60_000) : undefined

if (mode !== 'polling' && mode !== 'stuck-handler') {
  throw new Error(`Unknown fixture mode: ${mode}`)
}

const running = runWorkerProcess({
  signals: process,
  runIteration:
    mode === 'stuck-handler'
      ? () => new Promise(() => undefined)
      : () => Promise.resolve(),
  sleep: (signal) =>
    mode === 'polling' ? abortableDelay(60_000, signal) : Promise.resolve(),
  closeHealthServer: () => {
    if (keepAlive) clearInterval(keepAlive)
    process.stdout.write('health-closed\n')
    return Promise.resolve()
  },
  closeDatabase: () => {
    process.stdout.write('database-closed\n')
    return Promise.resolve()
  },
  flushSentry: () => {
    process.stdout.write('sentry-flushed\n')
    return Promise.resolve(true)
  },
  forceExit(code) {
    process.exit(code)
  },
  shutdownTimeoutMs: 150,
  logger: { info() {}, error() {} },
})

setImmediate(() => process.stdout.write('ready\n'))

await running

process.stdout.write('done\n')
