import pino, { type Logger } from 'pino'

export interface AppLogger {
  info(context: Record<string, unknown>, message: string): void
  error(context: Record<string, unknown>, message: string): void
}

export function createLogger(options: {
  level: string
  environment: string
  release: string
}): Logger {
  return pino({
    level: options.level,
    base: {
      service: 'api',
      environment: options.environment,
      release: options.release,
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        'req.headers.svix-id',
        'req.headers.svix-signature',
        'req.headers.svix-timestamp',
        '*.databaseUrl',
        '*.token',
        '*.secret',
        '*.password',
      ],
      censor: '[Redacted]',
    },
  })
}
