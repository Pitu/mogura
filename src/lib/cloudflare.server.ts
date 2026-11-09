import { z } from 'zod'
import { addIngressRule, removeIngressRule } from './ingress'
import type { DashboardData, IngressRule, ServicePublishResult, Tunnel, TunnelDiscovery } from './types'
import { serviceDestinations, serviceRoute } from './hostnames'
import { buildHostname, serviceSchema, type ApplicationInput, type Credentials, type RemoveRouteInput, type RouteInput, type ServiceInput } from './validation'

interface Envelope<T> {
  success: boolean
  result: T
  errors?: { message: string }[]
  result_info?: { total_pages?: number; total_count?: number; page?: number; per_page?: number }
}

const ingressSchema = z.object({ hostname: z.string().optional(), path: z.string().optional(), service: z.string() }).passthrough()
const configSchema = z.object({ source: z.string().optional(), version: z.number().optional(), config: z.object({ ingress: z.array(ingressSchema).default([]) }).passthrough() })
const tunnelSchema = z.object({ id: z.string(), name: z.string(), tun_type: z.string().optional(), status: z.enum(['healthy', 'degraded', 'down', 'inactive']).nullish(), remote_config: z.boolean().optional(), config_src: z.string().optional(), connections: z.array(z.unknown()).nullish(), created_at: z.string().nullish() })
const appSchema = z.object({ id: z.string(), name: z.string().optional(), domain: z.string().optional(), type: z.string(), session_duration: z.string().optional(), destinations: z.array(z.object({ type: z.string(), uri: z.string().optional() }).passthrough()).optional(), policies: z.array(z.union([z.string(), z.object({ id: z.string(), name: z.string().optional() }).passthrough()])).optional() })
const policySchema = z.object({ id: z.string(), name: z.string(), decision: z.string(), include: z.array(z.record(z.string(), z.unknown())).default([]) })
const zoneSchema = z.object({ id: z.string(), name: z.string() })

export class CloudflareApi {
  constructor(
    private readonly credentials: Credentials,
    private readonly fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  ) {}

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<Envelope<T>> {
    const { authType, secret, email } = this.credentials
    const response = await this.fetcher(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(authType === 'token' ? { Authorization: `Bearer ${secret}` } : { 'X-Auth-Key': secret, 'X-Auth-Email': email || '' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    const envelope = await response.json() as Envelope<T>
    if (!response.ok || !envelope.success) {
      throw new Error(envelope.errors?.map((error) => error.message).join(' · ') || `Cloudflare returned HTTP ${response.status}.`)
    }
    return envelope
  }

  private accountPath(path: string) { return `/accounts/${this.credentials.accountId}${path}` }

  private async list<T>(path: string, schema: z.ZodType<T>, onPage?: (response: Envelope<unknown[]>) => void): Promise<T[]> {
    const items: T[] = []
    for (let page = 1; ; page++) {
      const response = await this.request<unknown[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=50&page=${page}`)
      items.push(...z.array(schema).parse(response.result))
      onPage?.(response)
      const info = response.result_info
      if (info?.total_pages !== undefined ? page >= info.total_pages : info?.total_count !== undefined ? items.length >= info.total_count : response.result.length < (info?.per_page || 50)) break
      if (response.result.length === 0) throw new Error('Cloudflare returned an empty page before the reported total was reached.')
      if (page >= 200) throw new Error('Cloudflare returned more than 10,000 records. Narrow the account scope.')
    }
    return items
  }

  private async discoverTunnels() {
    const discovery: TunnelDiscovery = { state: 'empty', requests: [] }
    const endpoints = ['/tunnels?is_deleted=false&tun_types=cfd_tunnel', '/cfd_tunnel?is_deleted=false', '/tunnels?is_deleted=false']
    for (const endpoint of endpoints) {
      const diagnostic: TunnelDiscovery['requests'][number] = { endpoint, count: null, totalCount: null, types: [] }
      discovery.requests.push(diagnostic)
      try {
        const raw = await this.list(this.accountPath(endpoint), tunnelSchema, (page) => {
          if (page.result_info?.total_count !== undefined) diagnostic.totalCount = page.result_info.total_count
        })
        diagnostic.count = raw.length
        const types = new Map<string, number>()
        for (const tunnel of raw) {
          const type = tunnel.tun_type || 'cfd_tunnel'
          types.set(type, (types.get(type) || 0) + 1)
        }
        diagnostic.types = Array.from(types, ([type, count]) => ({ type, count }))
        const cloudflared = raw.filter((tunnel) => !tunnel.tun_type || tunnel.tun_type === 'cfd_tunnel')
        if (cloudflared.length) {
          discovery.state = 'loaded'
          return { tunnels: cloudflared, discovery }
        }
      } catch (error) {
        // Only diagnostic summaries cross the server boundary, never upstream bodies or headers.
        const message = error instanceof z.ZodError ? 'Cloudflare returned an unexpected tunnel response format.' : error instanceof Error ? error.message : 'Tunnel request failed.'
        diagnostic.error = message.split(this.credentials.secret).join('[redacted]')
      }
    }
    discovery.state = discovery.requests.some((request) => request.error) ? 'error' : 'empty'
    return { tunnels: [], discovery }
  }

  async snapshot(): Promise<DashboardData> {
    const [tunnelResult, rawApplications, policies, zones] = await Promise.all([
      this.discoverTunnels(),
      this.list(this.accountPath('/access/apps'), appSchema),
      this.list(this.accountPath('/access/policies'), policySchema),
      this.list(`/zones?account.id=${this.credentials.accountId}`, zoneSchema),
    ])
    const { tunnels: rawTunnels, discovery: tunnelDiscovery } = tunnelResult
    if (tunnelDiscovery.requests.length > 1) {
      console.info('[tunnel-discovery]', JSON.stringify({ accountSuffix: this.credentials.accountId.slice(-6), state: tunnelDiscovery.state, requests: tunnelDiscovery.requests.map(({ endpoint, count, totalCount, types, error }) => ({ endpoint, count, totalCount, types, failed: Boolean(error) })) }))
    }
    const tunnels: Tunnel[] = []
    // Bound configuration requests instead of flooding the API for large accounts.
    for (let index = 0; index < rawTunnels.length; index += 5) {
      tunnels.push(...await Promise.all(rawTunnels.slice(index, index + 5).map(async (raw): Promise<Tunnel> => {
        const tunnel: Tunnel = { id: raw.id, name: raw.name, status: raw.status || 'inactive', remote: raw.remote_config === true || raw.config_src === 'cloudflare', connections: raw.connections?.length || 0, createdAt: raw.created_at || '', routes: [] }
        if (!tunnel.remote) return tunnel
        try {
          const configuration = await this.configuration(raw.id)
          tunnel.routes = configuration.config.ingress.map(({ hostname, path, service }) => ({ hostname, path, service }))
          tunnel.configVersion = configuration.version
        } catch (error) { tunnel.error = error instanceof Error ? error.message : 'Couldn’t load tunnel configuration.' }
        return tunnel
      })))
    }
    return {
      mode: 'live', accountId: this.credentials.accountId, fetchedAt: new Date().toISOString(), tunnels, zones, tunnelDiscovery, policies: policies.map(({ id, name, decision, include }) => ({ id, name, decision, includeCount: include.length })),
      applications: rawApplications.filter((app) => app.type === 'self_hosted').map((app) => ({
        id: app.id, name: app.name || app.domain || 'Unnamed application', domain: app.domain || '', sessionDuration: app.session_duration || '24h',
        destinations: app.destinations?.filter((destination) => destination.type === 'public' && destination.uri).map((destination) => destination.uri!) || (app.domain ? [app.domain] : []),
        policies: (app.policies || []).map((policy) => typeof policy === 'string' ? { id: policy, name: policies.find((item) => item.id === policy)?.name } : policy),
      })),
    }
  }

  async createApplication(input: ApplicationInput, additionalDestinations: string[] = []): Promise<string> {
    const domain = buildHostname(input) + input.path
    const response = await this.request<unknown>(this.accountPath('/access/apps'), 'POST', {
      type: 'self_hosted', name: input.name, domain, destinations: [...new Set([domain, ...additionalDestinations])].map((uri) => ({ type: 'public', uri })),
      policies: input.policyIds.map((id, precedence) => ({ id, precedence: precedence + 1 })), session_duration: '24h',
    })
    return z.object({ id: z.string().min(1) }).parse(response.result).id
  }

  async publishService(rawInput: ServiceInput): Promise<ServicePublishResult> {
    const input = serviceSchema.parse(rawInput)
    const route = serviceRoute(input)
    const configuration = await this.writableConfiguration(input.tunnelId)
    addIngressRule(configuration.config.ingress, { hostname: buildHostname(route), path: route.path, service: route.service })

    const policies = await this.list(this.accountPath('/access/policies'), policySchema)
    for (const id of input.policyIds) {
      const policy = policies.find((candidate) => candidate.id === id)
      if (!policy) throw new Error('A selected policy no longer exists. Refresh and select it again.')
      if (policy.decision === 'bypass') throw new Error('Bypass policies cannot be used to publish a protected service.')
    }

    const destinations = serviceDestinations(input)
    const applicationId = input.applicationId || await this.createApplication(input, destinations)
    try {
      // Wait for a read-back confirming the application, destinations, and policy
      // links before either creating DNS or writing the tunnel configuration.
      const response = await this.request<unknown>(this.accountPath(`/access/apps/${applicationId}`))
      const app = appSchema.parse(response.result)
      const attachedIds = (app.policies || []).map((policy) => typeof policy === 'string' ? policy : policy.id)
      const publicDestinations = app.destinations?.filter((destination) => destination.type === 'public') || []
      const securedUris = publicDestinations.length ? publicDestinations.map((destination) => destination.uri) : [app.domain]
      if (app.type !== 'self_hosted' || app.name !== input.name || app.domain !== destinations[0] || !destinations.every((uri) => securedUris.includes(uri)) || attachedIds.length !== input.policyIds.length || !input.policyIds.every((id) => attachedIds.includes(id)) || publicDestinations.some((destination) => Array.isArray(destination.overrides) && destination.overrides.length > 0)) {
        throw new Error('The Access application does not yet match the requested destinations and policies. The route has not been published.')
      }
      await this.addRoute(route)
      return { status: 'published', applicationId }
    } catch (error) {
      // Keep Access in place on failure. A retry verifies and reuses this app.
      const message = error instanceof z.ZodError ? 'Cloudflare returned an unexpected application response. The route was not published.' : error instanceof Error ? error.message : 'Route publishing failed.'
      return { status: 'application_only', applicationId, error: message.split(this.credentials.secret).join('[redacted]') }
    }
  }

  async removeApplication(id: string) {
    const response = await this.request<unknown>(this.accountPath(`/access/apps/${id}`))
    if (appSchema.parse(response.result).type !== 'self_hosted') throw new Error('Only self-hosted applications can be removed here.')
    await this.request(this.accountPath(`/access/apps/${id}`), 'DELETE')
  }

  private async configuration(tunnelId: string) {
    const response = await this.request<unknown>(this.accountPath(`/cfd_tunnel/${tunnelId}/configurations`))
    return configSchema.parse(response.result)
  }

  private async writableConfiguration(tunnelId: string) {
    const response = await this.request<unknown>(this.accountPath(`/cfd_tunnel/${tunnelId}`))
    const tunnel = tunnelSchema.parse(response.result)
    if (!tunnel.remote_config && tunnel.config_src !== 'cloudflare') throw new Error('This tunnel uses a local configuration. Manage its routes in cloudflared’s YAML file.')
    return this.configuration(tunnelId)
  }

  async addRoute(input: RouteInput) {
    const hostname = buildHostname(input)
    const current = await this.writableConfiguration(input.tunnelId)
    const ingress = addIngressRule(current.config.ingress, { hostname, ...(input.path ? { path: input.path } : {}), service: input.service })
    let createdDns: { zoneId: string; id: string } | undefined
    if (input.createDns) {
      const zones = await this.list(`/zones?account.id=${this.credentials.accountId}`, zoneSchema)
      const zone = zones.find((item) => item.name === input.domain)
      if (!zone) throw new Error('This domain is not an accessible zone in this account.')
      const records = await this.list(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(hostname)}`, z.object({ id: z.string(), type: z.string(), content: z.string(), proxied: z.boolean().optional() }))
      const target = `${input.tunnelId}.cfargotunnel.com`
      if (records.some((record) => ['A', 'AAAA', 'CNAME'].includes(record.type) && !(record.type === 'CNAME' && record.content.toLowerCase() === target && record.proxied))) throw new Error('This hostname has a conflicting DNS record. Update it in Cloudflare before adding the route.')
      if (!records.some((record) => record.type === 'CNAME' && record.content.toLowerCase() === target && record.proxied)) {
        const response = await this.request<{ id: string }>(`/zones/${zone.id}/dns_records`, 'POST', { type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 })
        createdDns = { zoneId: zone.id, id: response.result.id }
      }
    }
    try {
      const latest = await this.configuration(input.tunnelId)
      if (latest.version !== current.version || JSON.stringify(latest.config) !== JSON.stringify(current.config)) throw new Error('The tunnel configuration changed. Refresh and try again.')
      await this.request(this.accountPath(`/cfd_tunnel/${input.tunnelId}/configurations`), 'PUT', { config: { ...current.config, ingress } })
    } catch (error) {
      if (createdDns) {
        try { await this.request(`/zones/${createdDns.zoneId}/dns_records/${createdDns.id}`, 'DELETE') }
        catch { throw new Error('Route creation failed and DNS cleanup failed. Check this hostname’s DNS record in Cloudflare, then refresh.') }
      }
      throw error
    }
  }

  async removeRoute(input: RemoveRouteInput) {
    const current = await this.writableConfiguration(input.tunnelId)
    const ingress: IngressRule[] = removeIngressRule(current.config.ingress, input)
    const latest = await this.configuration(input.tunnelId)
    if (latest.version !== current.version || JSON.stringify(latest.config) !== JSON.stringify(current.config)) throw new Error('The tunnel configuration changed. Refresh and try again.')
    await this.request(this.accountPath(`/cfd_tunnel/${input.tunnelId}/configurations`), 'PUT', { config: { ...current.config, ingress } })
  }
}
