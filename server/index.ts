import { join } from 'node:path'
import { loadSessionSecret, parsePublicOrigin, withPublicOrigin } from './runtime'

const port = Number(process.env.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.')

if (!process.env.SESSION_SECRET && process.env.SESSION_SECRET_FILE) {
  process.env.SESSION_SECRET = loadSessionSecret(process.env.SESSION_SECRET_FILE)
}
if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('Set SESSION_SECRET to at least 32 characters, or configure SESSION_SECRET_FILE on a persistent volume.')
}

const publicOrigin = parsePublicOrigin(process.env.APP_ORIGIN)
const root = join(import.meta.dir, '..')
const clientDirectory = join(root, 'dist/client')
const entryPath = join(root, 'dist/server/server.js')
const { default: app }: { default: { fetch: (request: Request) => Response | Promise<Response> } } = await import(entryPath)
const assets = new Map<string, Bun.BunFile>()
for (const path of new Bun.Glob('**/*').scanSync({ cwd: clientDirectory, onlyFiles: true })) {
  if (path.split('/').some((part) => part.startsWith('.'))) continue
  assets.set(`/${path}`, Bun.file(join(clientDirectory, path)))
}

const server = Bun.serve({
  hostname: process.env.HOST || '0.0.0.0',
  port,
  idleTimeout: 60,
  async fetch(request) {
    let pathname: string
    try { pathname = decodeURIComponent(new URL(request.url).pathname) }
    catch { return new Response('Bad request', { status: 400 }) }

    if (pathname === '/healthz') return new Response('ok', { headers: { 'Cache-Control': 'no-store' } })
    const asset = assets.get(pathname)
    if (asset) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
      return new Response(request.method === 'HEAD' ? null : asset, { headers: {
        'Content-Type': asset.type,
        'Content-Length': String(asset.size),
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      } })
    }
    if (pathname.startsWith('/assets/')) return new Response('Not found', { status: 404 })
    const response = await app.fetch(withPublicOrigin(request, publicOrigin))
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    return response
  },
  error(error) {
    console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error')
    return new Response('Internal server error', { status: 500 })
  },
})

console.info(`Mogura dashboard listening on http://${server.hostname}:${server.port}`)
process.once('SIGTERM', () => { void server.stop(false) })
process.once('SIGINT', () => { void server.stop(false) })
