import { describe, expect, test } from 'bun:test'
import { CloudflareApi } from './cloudflare.server'
import type { Credentials, RouteInput } from './validation'

const accountId = 'a'.repeat(32)
const tunnelId = '00000000-0000-4000-8000-000000000001'
const credentials: Credentials = { accountId, authType: 'token', secret: 'test-secret-token' }
const input: RouteInput = { tunnelId, subdomain: 'photos', domain: 'example.com', path: '', service: 'http://localhost:2283', createDns: true }
const configuration = { source: 'cloudflare', version: 9, config: { originRequest: { connectTimeout: 7 }, 'warp-routing': { enabled: true }, ingress: [{ hostname: 'files.example.com', service: 'https://localhost:8080', originRequest: { noTLSVerify: true } }, { service: 'http_status:404' }] } }

function envelope(result: unknown, extra: Record<string, unknown> = {}) {
  return Response.json({ success: true, result, ...extra })
}

function fixture({ failWrite = false, conflict = false, changed = false, failCleanup = false, existingDns = false } = {}) {
  const calls: { path: string; method: string; body: unknown; authorization: string | null }[] = []
  let configReads = 0
  const fetcher = async (url: string, init?: RequestInit) => {
    const parsed = new URL(url)
    const method = init?.method || 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ path: parsed.pathname + parsed.search, method, body, authorization: new Headers(init?.headers).get('Authorization') })
    if (parsed.pathname.endsWith('/configurations')) {
      if (method === 'PUT') return failWrite ? Response.json({ success: false, errors: [{ message: 'Configuration rejected' }] }, { status: 400 }) : envelope(configuration)
      configReads++
      return envelope({ ...configuration, version: changed && configReads > 1 ? 10 : 9 })
    }
    if (parsed.pathname.endsWith(`/cfd_tunnel/${tunnelId}`)) return envelope({ id: tunnelId, name: 'test', remote_config: true })
    if (parsed.pathname.endsWith('/zones')) return envelope([{ id: 'zone', name: 'example.com' }])
    if (parsed.pathname.endsWith('/dns_records')) {
      if (method === 'POST') return envelope({ id: 'new-record' })
      return envelope(conflict ? [{ id: 'old-record', type: 'A', content: '1.2.3.4' }] : existingDns ? [{ id: 'old-record', type: 'CNAME', content: `${tunnelId}.cfargotunnel.com`, proxied: true }] : [])
    }
    if (parsed.pathname.endsWith('/new-record') && method === 'DELETE') return failCleanup ? Response.json({ success: false, errors: [{ message: 'Cleanup failed' }] }, { status: 500 }) : envelope({ id: 'new-record' })
    throw new Error(`Unexpected API call: ${method} ${parsed.pathname}`)
  }
  return { api: new CloudflareApi(credentials, fetcher), calls }
}

describe('Cloudflare route mutations', () => {
  test('preserves the full configuration, per-route origin settings and final catch-all', async () => {
    const { api, calls } = fixture()
    await api.addRoute(input)
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ config: { ...configuration.config, ingress: [configuration.config.ingress[0], { hostname: 'photos.example.com', service: input.service }, configuration.config.ingress[1]] } })
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ type: 'CNAME', name: 'photos.example.com', content: `${tunnelId}.cfargotunnel.com`, proxied: true, ttl: 1 })
    expect(calls.every((call) => call.authorization === 'Bearer test-secret-token')).toBe(true)
  })
  test('does not overwrite a conflicting DNS record or change ingress', async () => {
    const { api, calls } = fixture({ conflict: true })
    await expect(api.addRoute(input)).rejects.toThrow('conflicting DNS')
    expect(calls.some((call) => call.method !== 'GET')).toBe(false)
  })
  test('rolls back only the DNS record it created if the ingress update fails', async () => {
    const { api, calls } = fixture({ failWrite: true })
    await expect(api.addRoute(input)).rejects.toThrow('Configuration rejected')
    expect(calls.at(-1)?.method).toBe('DELETE')
    expect(calls.at(-1)?.path).toEndWith('/dns_records/new-record')
    const existing = fixture({ failWrite: true, existingDns: true })
    await expect(existing.api.addRoute(input)).rejects.toThrow('Configuration rejected')
    expect(existing.calls.some((call) => call.method === 'DELETE')).toBe(false)
  })
  test('rejects detected concurrent configuration changes', async () => {
    const { api, calls } = fixture({ changed: true })
    await expect(api.addRoute({ ...input, createDns: false })).rejects.toThrow('configuration changed')
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })
  test('reports a failed DNS rollback explicitly', async () => {
    const { api } = fixture({ failWrite: true, failCleanup: true })
    await expect(api.addRoute(input)).rejects.toThrow('DNS cleanup failed')
  })
  test('removal preserves all remaining configuration and does not delete DNS', async () => {
    const { api, calls } = fixture()
    await api.removeRoute({ tunnelId, hostname: 'files.example.com', path: '', service: 'https://localhost:8080' })
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ config: { ...configuration.config, ingress: [configuration.config.ingress[1]] } })
    expect(calls.some((call) => call.path.includes('/dns_records'))).toBe(false)
  })
})

describe('Cloudflare reads and applications', () => {
  test('falls back to the cloudflared endpoint if the filtered list is empty', async () => {
    const api = new CloudflareApi(credentials, async (url) => {
      const path = new URL(url).pathname
      if (path.endsWith('/cfd_tunnel')) return envelope([{ id: tunnelId, name: 'REZE', status: 'healthy', config_src: 'local' }])
      return envelope([])
    })
    const data = await api.snapshot()
    expect(data.tunnels.map((tunnel) => tunnel.name)).toEqual(['REZE'])
    expect(data.tunnelDiscovery?.state).toBe('loaded')
    expect(data.tunnelDiscovery?.requests.map((request) => request.count)).toEqual([0, 1])
  })

  test('recovers cloudflared tunnels from the unfiltered account list and reports other types', async () => {
    const api = new CloudflareApi(credentials, async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/tunnels') && !parsed.searchParams.has('tun_types')) return envelope([
        { id: tunnelId, name: 'REZE', status: 'healthy', tun_type: 'cfd_tunnel', config_src: 'local' },
        { id: 'warp-node', name: 'Mesh node', tun_type: 'warp_connector' },
      ])
      return envelope([])
    })
    const data = await api.snapshot()
    expect(data.tunnels.map((tunnel) => tunnel.name)).toEqual(['REZE'])
    expect(data.tunnelDiscovery?.requests.at(-1)?.types).toEqual([{ type: 'cfd_tunnel', count: 1 }, { type: 'warp_connector', count: 1 }])
  })

  test('keeps Access applications available and reports tunnel permissions errors without leaking credentials', async () => {
    const api = new CloudflareApi(credentials, async (url) => {
      const path = new URL(url).pathname
      if (path.endsWith('/tunnels') || path.endsWith('/cfd_tunnel')) return Response.json({ success: false, errors: [{ message: `Permission denied for ${credentials.secret}` }] }, { status: 403 })
      if (path.endsWith('/access/apps')) return envelope([{ id: 'app', type: 'self_hosted', name: 'Photos', domain: 'photos.example.com' }])
      return envelope([])
    })
    const data = await api.snapshot()
    expect(data.tunnelDiscovery?.state).toBe('error')
    expect(data.tunnelDiscovery?.requests.every((request) => request.error?.includes('Permission denied'))).toBe(true)
    expect(data.applications).toHaveLength(1)
    expect(JSON.stringify(data)).not.toContain(credentials.secret)
  })

  test('uses the reported page size and total instead of assuming Cloudflare honored per_page', async () => {
    const api = new CloudflareApi(credentials, async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/tunnels')) {
        const page = Number(parsed.searchParams.get('page'))
        return envelope([{ id: `tunnel-${page}`, name: `Tunnel ${page}`, config_src: 'local' }], { result_info: { page, per_page: 1, total_count: 3 } })
      }
      return envelope([])
    })
    const data = await api.snapshot()
    expect(data.tunnels).toHaveLength(3)
    expect(data.tunnelDiscovery?.requests[0].totalCount).toBe(3)
  })

  test('discovers every cloudflared tunnel regardless of health and loads remote routes', async () => {
    const statuses = ['healthy', 'down', 'inactive'] as const
    const calls: string[] = []
    const api = new CloudflareApi(credentials, async (url) => {
      calls.push(url)
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/tunnels')) {
        expect(parsed.searchParams.get('tun_types')).toBe('cfd_tunnel')
        expect(parsed.searchParams.get('is_deleted')).toBe('false')
        expect(parsed.searchParams.has('status')).toBe(false)
        return envelope(statuses.map((status, index) => ({ id: `tunnel-${index}`, name: `Tunnel ${index}`, status, config_src: index === 2 ? 'local' : 'cloudflare', tun_type: 'cfd_tunnel' })))
      }
      if (parsed.pathname.endsWith('/configurations')) return envelope(configuration)
      if (parsed.pathname.endsWith('/access/apps') || parsed.pathname.endsWith('/access/policies') || parsed.pathname.endsWith('/zones')) return envelope([])
      throw new Error(`Unexpected endpoint: ${parsed.pathname}`)
    })
    const data = await api.snapshot()
    expect(data.tunnels.map((tunnel) => tunnel.status)).toEqual([...statuses])
    expect(data.tunnels.slice(0, 2).map((tunnel) => tunnel.routes.length)).toEqual([2, 2])
    expect(data.tunnels[2].remote).toBe(false)
    expect(calls.filter((url) => url.includes('/configurations'))).toHaveLength(2)
  })

  test('reads all pages and exposes only self-hosted applications', async () => {
    const calls: string[] = []
    const api = new CloudflareApi(credentials, async (url) => {
      calls.push(url)
      const parsed = new URL(url)
      const page = parsed.searchParams.get('page')
      if (parsed.pathname.endsWith('/tunnels') || parsed.pathname.endsWith('/cfd_tunnel')) return envelope([], { result_info: { total_pages: 1 } })
      if (parsed.pathname.endsWith('/access/apps')) return envelope(page === '1' ? [{ id: 'self-1', type: 'self_hosted', domain: 'photos.example.com', policies: ['p1'] }, { id: 'saas', type: 'saas' }] : [{ id: 'self-2', type: 'self_hosted', domain: 'files.example.com' }], { result_info: { total_pages: 2 } })
      if (parsed.pathname.endsWith('/access/policies')) return envelope([{ id: 'p1', name: 'Owner', decision: 'allow', include: [{ everyone: {} }] }])
      if (parsed.pathname.endsWith('/zones')) return envelope([{ id: 'zone', name: 'example.com' }])
      throw new Error('Unexpected endpoint')
    })
    const data = await api.snapshot()
    expect(data.applications.map((app) => app.id)).toEqual(['self-1', 'self-2'])
    expect(data.applications[0].policies).toEqual([{ id: 'p1', name: 'Owner' }])
    expect(calls.filter((url) => url.includes('/access/apps'))).toHaveLength(2)
    expect(data.policies[0].includeCount).toBe(1)
  })
  test('creates a public destination and attaches reusable policies in order', async () => {
    let sent: unknown
    const api = new CloudflareApi(credentials, async (_, init) => { sent = JSON.parse(String(init?.body)); return envelope({ id: 'created' }) })
    await api.createApplication({ name: 'Photos', subdomain: 'photos', domain: 'example.com', path: '/admin', policyIds: ['p1', 'p2'] })
    expect(sent).toEqual({ type: 'self_hosted', name: 'Photos', domain: 'photos.example.com/admin', destinations: [{ type: 'public', uri: 'photos.example.com/admin' }], policies: [{ id: 'p1', precedence: 1 }, { id: 'p2', precedence: 2 }], session_duration: '24h' })
  })
  test('uses key/email authentication for global API keys', async () => {
    let headers: Headers | undefined
    const api = new CloudflareApi({ ...credentials, authType: 'key', email: 'kana@example.com' }, async (_, init) => { headers = new Headers(init?.headers); return envelope({ id: 'created' }) })
    await api.createApplication({ name: 'Photos', subdomain: 'photos', domain: 'example.com', path: '', policyIds: ['p1'] })
    expect(headers?.get('X-Auth-Key')).toBe('test-secret-token')
    expect(headers?.get('X-Auth-Email')).toBe('kana@example.com')
    expect(headers?.has('Authorization')).toBe(false)
  })
})
