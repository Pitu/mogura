import { expect, test } from 'bun:test'
import { demoData } from './demo'

test('demo fixtures use reserved example domains and documentation-only service addresses', () => {
  const isExampleHostname = (hostname: string) => ['example.com', 'example.net', 'example.org'].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  for (const zone of demoData.zones) expect(isExampleHostname(zone.name)).toBe(true)
  for (const application of demoData.applications) {
    expect(isExampleHostname(application.domain)).toBe(true)
    for (const destination of application.destinations) expect(isExampleHostname(destination)).toBe(true)
  }
  for (const tunnel of demoData.tunnels) {
    for (const route of tunnel.routes) {
      if (route.hostname) expect(isExampleHostname(route.hostname)).toBe(true)
      if (route.service.startsWith('http_status:')) continue
      expect(['localhost', '192.0.2.10', '192.0.2.20']).toContain(new URL(route.service).hostname)
    }
  }
})
