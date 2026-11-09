import { describe, expect, test } from 'bun:test'
import { CloudflareApi } from './cloudflare.server'
import { findApplication } from './access'
import { getInitialHostname, serviceDestinations, serviceRoute } from './hostnames'
import { serviceSchema, type ServiceInput } from './validation'

const applicationId = '00000000-0000-4000-8000-000000000010'
const policyId = '00000000-0000-4000-8000-000000000020'
const tunnelId = '00000000-0000-4000-8000-000000000030'
const input: ServiceInput = { name: 'Photos', subdomain: 'photos', domain: 'example.com', path: '', policyIds: [policyId], tunnelId, service: 'http://localhost:2283', createDns: true }

function serviceFixture(options: { applicationFails?: boolean; routeFails?: boolean; policiesMissing?: boolean; bypass?: boolean; readbackFails?: boolean; resumed?: ServiceInput; wrongDestination?: boolean } = {}) {
  const calls: { path: string; method: string; body?: unknown }[] = []
  let application: { id: string; type: string; name: string; domain: string; destinations: { type: string; uri: string }[]; policies: { id: string; precedence: number }[] } = {
    id: applicationId, type: 'self_hosted', name: input.name, domain: serviceDestinations(options.resumed || input)[0], destinations: serviceDestinations(options.resumed || input).map((uri) => ({ type: 'public', uri })), policies: [{ id: policyId, precedence: 1 }],
  }
  const configuration = { source: 'cloudflare', version: 1, config: { originRequest: { connectTimeout: 7 }, ingress: [{ service: 'http_status:404' }] } }
  const ok = (result: unknown) => Response.json({ success: true, result })
  const fail = (message: string) => Response.json({ success: false, errors: [{ message }] }, { status: 400 })
  const api = new CloudflareApi({ accountId: 'a'.repeat(32), authType: 'token', secret: 'test-service-token' }, async (url, init) => {
    const path = new URL(url).pathname
    const method = init?.method || 'GET'
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, method, body })
    if (path.endsWith(`/cfd_tunnel/${tunnelId}`)) return ok({ id: tunnelId, name: 'REZE', config_src: 'cloudflare' })
    if (path.endsWith('/configurations')) return method === 'PUT' && options.routeFails ? fail('Configuration rejected') : ok(configuration)
    if (path.endsWith('/access/policies')) return ok([{ id: policyId, name: 'Only me', decision: options.bypass ? 'bypass' : 'allow', include: [] }])
    if (path.endsWith('/access/apps') && method === 'POST') {
      if (options.applicationFails) return fail('Application creation failed')
      const parsed = body as Omit<typeof application, 'id'>
      application = { ...parsed, id: applicationId }
      return ok(application)
    }
    if (path.endsWith(`/access/apps/${applicationId}`) && method === 'GET') {
      if (options.readbackFails) return fail('Application read failed')
      return ok({ ...application, ...(options.policiesMissing ? { policies: [] } : {}), ...(options.wrongDestination ? { destinations: [{ type: 'public', uri: 'wrong.example.com' }] } : {}) })
    }
    if (path.endsWith('/zones')) return ok([{ id: 'zone', name: 'example.com' }])
    if (path.endsWith('/dns_records')) return ok(method === 'POST' ? { id: 'new-record' } : [])
    if (path.endsWith('/dns_records/new-record') && method === 'DELETE') return ok({ id: 'new-record' })
    throw new Error(`Unexpected API call: ${method} ${path}`)
  })
  return { api, calls }
}

describe('unified service publishing', () => {
  test('creates and verifies Access before creating DNS and publishing ingress', async () => {
    const { api, calls } = serviceFixture()
    expect(await api.publishService(input)).toEqual({ status: 'published', applicationId })
    const created = calls.findIndex((call) => call.method === 'POST' && call.path.endsWith('/access/apps'))
    const verified = calls.findIndex((call) => call.method === 'GET' && call.path.endsWith(`/access/apps/${applicationId}`))
    const dns = calls.findIndex((call) => call.method === 'POST' && call.path.endsWith('/dns_records'))
    const route = calls.findIndex((call) => call.method === 'PUT' && call.path.endsWith('/configurations'))
    expect(created).toBeGreaterThan(-1)
    expect(verified).toBeGreaterThan(created)
    expect(dns).toBeGreaterThan(verified)
    expect(route).toBeGreaterThan(dns)
    expect(calls[created].body).toMatchObject({ name: 'Photos', domain: 'photos.example.com', destinations: [{ type: 'public', uri: 'photos.example.com' }], policies: [{ id: policyId, precedence: 1 }] })
  })

  test('does not create DNS or write ingress when application creation fails', async () => {
    const { api, calls } = serviceFixture({ applicationFails: true })
    await expect(api.publishService(input)).rejects.toThrow('Application creation failed')
    expect(calls.some((call) => call.path.includes('/dns_records') || call.method === 'PUT')).toBe(false)
  })

  test('requires policy attachment and destination verification before publishing', async () => {
    for (const options of [{ policiesMissing: true }, { wrongDestination: true }, { readbackFails: true }]) {
      const { api, calls } = serviceFixture(options)
      const result = await api.publishService(input)
      expect(result.status).toBe('application_only')
      expect(result.applicationId).toBe(applicationId)
      expect(calls.some((call) => call.path.includes('/dns_records') || call.method === 'PUT')).toBe(false)
    }
  })

  test('keeps Access on route failure and reuses it on retry', async () => {
    const failed = serviceFixture({ routeFails: true })
    const result = await failed.api.publishService(input)
    expect(result).toEqual({ status: 'application_only', applicationId, error: 'Configuration rejected' })
    expect(failed.calls.some((call) => call.method === 'DELETE' && call.path.includes('/access/apps'))).toBe(false)
    const retry = serviceFixture({ resumed: input })
    expect(await retry.api.publishService({ ...input, applicationId })).toEqual({ status: 'published', applicationId })
    expect(retry.calls.some((call) => call.method === 'POST' && call.path.endsWith('/access/apps'))).toBe(false)
  })

  test('includes a different route destination in Access before publishing it', async () => {
    const separate = { ...input, routeHostname: { subdomain: 'albums', domain: 'example.com', path: '/photos' } }
    const { api, calls } = serviceFixture()
    expect((await api.publishService(separate)).status).toBe('published')
    expect(calls.find((call) => call.method === 'POST' && call.path.endsWith('/access/apps'))?.body).toMatchObject({ destinations: [{ type: 'public', uri: 'photos.example.com' }, { type: 'public', uri: 'albums.example.com/photos' }] })
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ config: { ingress: [{ hostname: 'albums.example.com', path: '^/photos(/.*)?$', service: input.service }, { service: 'http_status:404' }] } })
  })

  test('rejects bypass policies and missing policy selections', async () => {
    const { api, calls } = serviceFixture({ bypass: true })
    await expect(api.publishService(input)).rejects.toThrow('Bypass policies')
    expect(calls.some((call) => call.method !== 'GET')).toBe(false)
    expect(serviceSchema.safeParse({ ...input, policyIds: [] }).success).toBe(false)
  })

  test('does not trust a supplied application ID with different policy attachments', async () => {
    const { api, calls } = serviceFixture({ policiesMissing: true })
    expect((await api.publishService({ ...input, applicationId })).status).toBe('application_only')
    expect(calls.some((call) => call.method !== 'GET')).toBe(false)
  })
})

describe('shared hostname values', () => {
  test('uses the first account zone and preserves an explicitly supplied hostname', () => {
    const zones = [{ name: 'example.net' }, { name: 'example.com' }]
    expect(getInitialHostname(zones).domain).toBe('example.net')
    expect(getInitialHostname(zones, 'photos.example.com')).toEqual({ domain: 'example.com', subdomain: 'photos', path: '' })
    expect(getInitialHostname([{ name: 'example.net' }]).domain).toBe('example.net')
  })

  test('anchors literal paths so the route does not exceed the Access path', () => {
    const route = serviceRoute({ ...input, path: '/admin.v2' })
    const pattern = new RegExp(route.path)
    expect(pattern.test('/admin.v2')).toBe(true)
    expect(pattern.test('/admin.v2/users')).toBe(true)
    expect(pattern.test('/adminXv2')).toBe(false)
    expect(pattern.test('/admin.v2other')).toBe(false)
    expect(pattern.test('/other/admin.v2')).toBe(false)
    expect(serviceSchema.safeParse({ ...input, path: '/admin|/public' }).success).toBe(false)
  })

  test('matches the published path expression back to its Access application', () => {
    const route = serviceRoute({ ...input, path: '/admin.v2' })
    const app = { id: applicationId, name: input.name, domain: 'photos.example.com/admin.v2', destinations: ['photos.example.com/admin.v2'], policies: [{ id: policyId }], sessionDuration: '24h' }
    expect(findApplication({ hostname: 'photos.example.com', service: input.service, path: route.path }, [app])).toEqual(app)
  })
})
