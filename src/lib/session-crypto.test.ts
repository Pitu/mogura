import { expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { getSessionEncryptionKey, openCredentials, sealCredentials, sessionLifetime } from './session-crypto.server'
import type { Credentials } from './validation'

const credentials: Credentials = { accountId: 'a'.repeat(32), authType: 'token', secret: 'test-token-never-log' }

test('a session remains decryptable after the crypto module is reloaded', async () => {
  const originalKey = getSessionEncryptionKey()
  const cookie = sealCredentials(credentials, originalKey)
  const modulePath = `./session-crypto.server.ts?reload=${crypto.randomUUID()}`
  const reloaded: typeof import('./session-crypto.server') = await import(modulePath)
  expect(reloaded.getSessionEncryptionKey()).toEqual(originalKey)
  expect(reloaded.openCredentials(cookie, reloaded.getSessionEncryptionKey())).toEqual(credentials)
  expect(cookie).not.toContain(credentials.secret)
})

test('session expiration is enforced after eight hours', () => {
  const key = randomBytes(32)
  const now = 1_000_000
  const cookie = sealCredentials(credentials, key, now)
  expect(openCredentials(cookie, key, now + sessionLifetime * 1000 - 1)).toEqual(credentials)
  expect(openCredentials(cookie, key, now + sessionLifetime * 1000)).toBeNull()
})

test('rejects tampered, malformed, and wrongly encrypted cookies', () => {
  const key = randomBytes(32)
  const cookie = sealCredentials(credentials, key)
  const bytes = Buffer.from(cookie, 'base64url')
  bytes[bytes.length - 1] ^= 1
  expect(openCredentials(bytes.toString('base64url'), key)).toBeNull()
  expect(openCredentials(cookie, randomBytes(32))).toBeNull()
  expect(openCredentials('invalid', key)).toBeNull()
})
