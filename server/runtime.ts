import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function loadSessionSecret(path: string): string {
  mkdirSync(dirname(path), { recursive: true })
  try {
    writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
  const secret = readFileSync(path, 'utf8').trim()
  if (secret.length < 32) throw new Error('The session secret file must contain at least 32 characters.')
  return secret
}

export function parsePublicOrigin(value: string | undefined): URL | undefined {
  if (!value) return undefined
  const origin = new URL(value)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin, such as https://dashboard.example.com.')
  }
  return origin
}

export function withPublicOrigin(request: Request, origin: URL | undefined): Request {
  if (!origin) return request
  const url = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',', 1)[0]?.trim()
  const requestHost = forwardedHost || request.headers.get('host') || url.host
  // Only normalize requests for the public hostname. Direct LAN/localhost
  // requests retain their HTTP origin so their session cookies work too.
  if (requestHost.toLowerCase() !== origin.host.toLowerCase()) return request
  url.protocol = origin.protocol
  url.host = origin.host
  url.port = origin.port
  const forwarded = new Request(url, request)
  forwarded.headers.set('host', origin.host)
  forwarded.headers.set('x-forwarded-host', origin.host)
  forwarded.headers.set('x-forwarded-proto', origin.protocol.slice(0, -1))
  return forwarded
}
