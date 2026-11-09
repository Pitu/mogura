import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSessionSecret, parsePublicOrigin, withPublicOrigin } from './runtime'

test('persists the session key across process starts with owner-only file access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tunnel-session-'))
  try {
    const path = join(directory, 'data/session.key')
    const original = loadSessionSecret(path)
    expect(original.length).toBe(64)
    expect(loadSessionSecret(path)).toBe(original)
    expect(readFileSync(path, 'utf8')).toBe(original)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('preserves POST data and caller origin while normalizing the public URL', async () => {
  const request = new Request('http://dashboard:3000/_server/action?test=1', { method: 'POST', headers: { Host: 'dashboard.example.com', Origin: 'https://dashboard.example.com', Cookie: 'tunnel_session=encrypted', 'X-Forwarded-Proto': 'http' }, body: 'request-body' })
  const forwarded = withPublicOrigin(request, parsePublicOrigin('https://dashboard.example.com'))
  expect(forwarded.url).toBe('https://dashboard.example.com/_server/action?test=1')
  expect(forwarded.headers.get('origin')).toBe('https://dashboard.example.com')
  expect(forwarded.headers.get('x-forwarded-proto')).toBe('https')
  expect(forwarded.headers.get('host')).toBe('dashboard.example.com')
  expect(forwarded.headers.get('cookie')).toBe('tunnel_session=encrypted')
  expect(await forwarded.text()).toBe('request-body')
})

test('does not rewrite a cross-site origin into a trusted origin', () => {
  const request = new Request('http://dashboard:3000/_server/action', { headers: { Origin: 'https://other.example.com' } })
  expect(withPublicOrigin(request, parsePublicOrigin('https://dashboard.example.com')).headers.get('origin')).toBe('https://other.example.com')
})

test('preserves the HTTP origin for LAN access alongside the HTTPS deployment hostname', () => {
  const request = new Request('http://192.0.2.30:3002/_server/action', { headers: { Host: '192.0.2.30:3002', Origin: 'http://192.0.2.30:3002' } })
  const forwarded = withPublicOrigin(request, parsePublicOrigin('https://dashboard.example.com'))
  expect(forwarded).toBe(request)
  expect(new URL(forwarded.url).origin).toBe('http://192.0.2.30:3002')
  expect(forwarded.headers.get('origin')).toBe('http://192.0.2.30:3002')
  expect(forwarded.headers.get('x-forwarded-proto')).toBeNull()
})

test('normalizes requests when the proxy forwards the deployment hostname', () => {
  const request = new Request('http://dashboard:3000/', { headers: { 'X-Forwarded-Host': 'dashboard.example.com' } })
  expect(withPublicOrigin(request, parsePublicOrigin('https://dashboard.example.com')).url).toBe('https://dashboard.example.com/')
})

test('validates the public origin and permits local direct serving without one', () => {
  for (const value of ['ftp://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?query=true']) expect(() => parsePublicOrigin(value)).toThrow()
  const request = new Request('http://localhost:3000/')
  expect(withPublicOrigin(request, undefined)).toBe(request)
})
