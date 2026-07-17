export function normalizeApiBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('API base URL must be an absolute URL')
  }

  const isLoopback =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (url.protocol !== 'https:' && !isLoopback) {
    throw new Error('API base URL must use HTTPS unless it is loopback')
  }

  return value.replace(/\/+$/, '')
}
