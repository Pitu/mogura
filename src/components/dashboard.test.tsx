import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { demoData } from '../lib/demo'
import type { DashboardData } from '../lib/types'
import { Dashboard } from './dashboard'

function renderDashboard(data: DashboardData) {
  return renderToStaticMarkup(<Dashboard initialData={{ ...data, accountId: data.accountId || 'a'.repeat(32) }} initialError="" view="tunnels" onViewChange={() => {}} />)
}

test('a missing connection opens Settings without showing sample resources or creation actions', () => {
  const html = renderToStaticMarkup(<Dashboard initialData={null} initialError="" view="tunnels" onViewChange={() => {}} />)
  expect(html).toContain('Connect Cloudflare')
  for (const name of ['Example workspace', 'Demo workspace', 'Example data', 'New service', 'New application', ...demoData.tunnels.map((tunnel) => tunnel.name)]) expect(html).not.toContain(name)
  expect(html).not.toContain('<tbody>')
})

test('a connection error shows the connection form and the actual error without sample data', () => {
  const html = renderToStaticMarkup(<Dashboard initialData={null} initialError="Saved credentials could not be decrypted." view="applications" onViewChange={() => {}} />)
  expect(html).toContain('Saved credentials could not be decrypted.')
  expect(html).toContain('Connect account')
  expect(html).not.toContain('Example data')
  expect(html).not.toContain('<tbody>')
})

test('renders all account applications when no tunnels are returned', () => {
  const applications = Array.from({ length: 15 }, (_, index) => ({
    ...demoData.applications[0], id: `app-${index}`, name: `Application ${index}`, domain: `app${index}.example.com`, destinations: [`app${index}.example.com`],
  }))
  const html = renderDashboard({ ...demoData, mode: 'live', tunnels: [], applications })
  const tableBody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || ''
  expect(tableBody.match(/<tr>/g)).toHaveLength(15)
  for (const application of applications) expect(tableBody).toContain(application.domain)
})

test('keeps applications visible when selecting a tunnel with no matching routes', () => {
  const html = renderDashboard({ ...demoData, tunnels: [demoData.tunnels[2]] })
  const tableBody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || ''
  expect(tableBody.match(/<tr>/g)).toHaveLength(demoData.applications.length)
})

test('shows the total tunnel count even when none are healthy', () => {
  const tunnels = demoData.tunnels.map((tunnel) => ({ ...tunnel, status: 'down' as const }))
  const html = renderDashboard({ ...demoData, tunnels })
  const summary = html.match(/class="network-summary">([\s\S]*?)<\/div>/)?.[1] || ''
  expect(summary).toContain('<strong>3</strong> tunnels')
  expect(summary).toContain('0 healthy')
  for (const tunnel of tunnels) expect(html).toContain(tunnel.name)
})

test('shows failed retrieval as unknown instead of zero and includes diagnostic details', () => {
  const html = renderDashboard({ ...demoData, mode: 'live', tunnels: [], tunnelDiscovery: { state: 'error', requests: [{ endpoint: '/tunnels?is_deleted=false', count: null, totalCount: null, types: [], error: 'Permission denied' }] } })
  expect(html).toContain('nav-count">?</span>')
  expect(html).toContain('Couldn’t load tunnels')
  expect(html).toContain('Permission denied')
  expect(html).toContain('Copy diagnostic')
  expect(html).not.toContain('0 healthy')
  const tableBody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || ''
  expect(tableBody.match(/<tr>/g)).toHaveLength(demoData.applications.length)
})
