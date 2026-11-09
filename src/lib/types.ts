export interface IngressRule {
  hostname?: string
  path?: string
  service: string
}

export interface Tunnel {
  id: string
  name: string
  status: 'healthy' | 'degraded' | 'down' | 'inactive'
  remote: boolean
  connections: number
  createdAt: string
  routes: IngressRule[]
  configVersion?: number
  error?: string
}

export interface AccessPolicy {
  id: string
  name: string
  decision: string
  includeCount: number
}

export interface AccessApplication {
  id: string
  name: string
  domain: string
  destinations: string[]
  policies: { id: string; name?: string }[]
  sessionDuration: string
}

export interface TunnelDiscovery {
  state: 'loaded' | 'empty' | 'error'
  requests: {
    endpoint: string
    count: number | null
    totalCount: number | null
    types: { type: string; count: number }[]
    error?: string
  }[]
}

export type ServicePublishResult =
  | { status: 'published'; applicationId: string }
  | { status: 'application_only'; applicationId: string; error: string }

export interface DashboardData {
  mode: 'demo' | 'live'
  accountId: string
  source?: 'storage' | 'environment'
  tunnels: Tunnel[]
  applications: AccessApplication[]
  policies: AccessPolicy[]
  zones: { id: string; name: string }[]
  fetchedAt: string
  tunnelDiscovery?: TunnelDiscovery
}
