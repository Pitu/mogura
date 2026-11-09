import type { AccessApplication, DashboardData } from './types'
import { buildHostname, type ApplicationInput } from './validation'

export function createDemoId(): string {
  // getRandomValues also works on HTTP LAN origins, unlike randomUUID.
  return `demo-${Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('')}`
}

export function createDemoApplication(input: ApplicationInput, id: string, policies: DashboardData['policies'], destinations = [buildHostname(input) + input.path]): AccessApplication {
  return { id, name: input.name, domain: buildHostname(input) + input.path, destinations, policies: input.policyIds.map((policyId) => ({ id: policyId, name: policies.find((policy) => policy.id === policyId)?.name })), sessionDuration: '24h' }
}

export const demoData: DashboardData = {
  mode: 'demo',
  accountId: '',
  fetchedAt: '',
  zones: [{ id: 'demo-zone', name: 'example.com' }, { id: 'demo-zone-2', name: 'example.net' }],
  policies: [
    { id: '00000000-0000-4000-8000-000000000001', name: 'Only me', decision: 'allow', includeCount: 1 },
    { id: '00000000-0000-4000-8000-000000000002', name: 'Friends & family', decision: 'allow', includeCount: 1 },
    { id: '00000000-0000-4000-8000-000000000003', name: 'Service tokens', decision: 'non_identity', includeCount: 1 },
  ],
  applications: [
    { id: 'app-1', name: 'Photos', domain: 'photos.example.com', destinations: ['photos.example.com'], policies: [{ id: '00000000-0000-4000-8000-000000000002', name: 'Friends & family' }], sessionDuration: '24h' },
    { id: 'app-2', name: 'Files', domain: 'files.example.com', destinations: ['files.example.com'], policies: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Only me' }], sessionDuration: '24h' },
    { id: 'app-3', name: 'Admin', domain: 'admin.example.com', destinations: ['admin.example.com'], policies: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Only me' }], sessionDuration: '24h' },
    { id: 'app-4', name: 'Home', domain: 'home.example.com', destinations: ['home.example.com'], policies: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Only me' }], sessionDuration: '24h' },
    { id: 'app-5', name: 'Metrics', domain: 'metrics.example.com', destinations: ['metrics.example.com'], policies: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Only me' }], sessionDuration: '24h' },
  ],
  tunnels: [
    {
      id: 'a84f6e21-7bd3-4ce2-9e15-0a62d7c89b34', name: 'EDGE', status: 'healthy', remote: true, connections: 4, createdAt: '2026-08-12T10:00:00Z',
      routes: [
        { hostname: 'example.com', service: 'http://localhost:3000' },
        { hostname: 'photos.example.com', service: 'http://192.0.2.10:2283' },
        { hostname: 'files.example.com', service: 'http://192.0.2.10:8080' },
        { hostname: 'admin.example.com', service: 'https://192.0.2.10:9443' },
        { hostname: 'music.example.com', service: 'http://localhost:8888' },
        { hostname: 'notes.example.com', service: 'http://localhost:5173' },
        { service: 'http_status:404' },
      ],
    },
    {
      id: 'bc72d9f0-0ea8-4f81-9b6e-3d251adf6912', name: 'LAB', status: 'healthy', remote: true, connections: 4, createdAt: '2026-09-01T10:00:00Z',
      routes: [
        { hostname: 'home.example.com', service: 'http://192.0.2.20:8123' },
        { hostname: 'metrics.example.com', service: 'http://192.0.2.20:3000' },
        { hostname: 'status.example.com', service: 'http://192.0.2.20:3001' },
        { service: 'http_status:404' },
      ],
    },
    { id: 'e1d4b523-9f0c-4b21-a38d-4c02e9517f6a', name: 'DEV', status: 'inactive', remote: true, connections: 0, createdAt: '2026-10-18T10:00:00Z', routes: [{ hostname: 'preview.example.net', service: 'http://localhost:3000' }, { service: 'http_status:404' }] },
  ],
}
