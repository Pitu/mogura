import { describe, expect, test } from 'bun:test'
import { addIngressRule, removeIngressRule } from './ingress'
import { findApplication } from './access'
import type { AccessApplication } from './types'

describe('ingress changes', () => {
  const original = [
    { hostname: 'photos.example.com', service: 'https://localhost:2283', originRequest: { noTLSVerify: true, connectTimeout: 17 } },
    { service: 'http_status:404' },
  ]

  test('adds before the catch-all and retains origin settings without mutation', () => {
    const rule = { hostname: 'files.example.com', service: 'http://localhost:8080' }
    expect(addIngressRule(original, rule)).toEqual([original[0], rule, original[1]])
    expect(original).toHaveLength(2)
  })
  test('inserts a path route before a broader hostname route', () => {
    const rule = { hostname: 'photos.example.com', path: '/api', service: 'http://localhost:8080' }
    expect(addIngressRule(original, rule)).toEqual([rule, ...original])
  })
  test('inserts a specific hostname before an existing wildcard', () => {
    const wildcard = { hostname: '*.example.com', service: 'http://localhost:3000' }
    const rule = { hostname: 'photos.example.com', service: 'http://localhost:2283' }
    expect(addIngressRule([wildcard, original[1]], rule)).toEqual([rule, wildcard, original[1]])
  })
  test('rejects duplicate host/path rules regardless of the service', () => {
    expect(() => addIngressRule(original, { hostname: 'photos.example.com', service: 'http://localhost:3333', path: '' })).toThrow('already exists')
  })
  test('removes only the exact host/path/service and retains the fallback', () => {
    const pathRule = { hostname: 'photos.example.com', path: '/api', service: 'http://localhost:3000' }
    expect(removeIngressRule([pathRule, ...original], pathRule)).toEqual(original)
    expect(() => removeIngressRule(original, { hostname: 'photos.example.com', service: 'http://changed:3000' })).toThrow('changed or was removed')
  })
})

describe('Access application matching', () => {
  const application: AccessApplication = { id: 'app', name: 'Photos', domain: 'photos.example.com/admin', destinations: ['photos.example.com/admin'], policies: [{ id: 'policy' }], sessionDuration: '24h' }
  test('respects path boundaries instead of labeling unrelated paths', () => {
    expect(findApplication({ hostname: 'photos.example.com', path: '/administrator', service: 'http://localhost' }, [application])).toBeUndefined()
    expect(findApplication({ hostname: 'photos.example.com', path: '/admin/users', service: 'http://localhost' }, [application])).toEqual(application)
    expect(findApplication({ hostname: 'photos.example.com', service: 'http://localhost' }, [application])).toBeUndefined()
  })
  test('matches wildcard hostnames and multiple destinations', () => {
    const wildcard = { ...application, destinations: ['*.example.com'] }
    expect(findApplication({ hostname: 'files.example.com', service: 'http://localhost' }, [wildcard])).toEqual(wildcard)
    expect(findApplication({ hostname: 'example.com', service: 'http://localhost' }, [wildcard])).toBeUndefined()
  })
})
