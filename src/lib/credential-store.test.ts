import { expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSessionSecret } from '../../server/runtime'
import { readStoredCredentials, resolveCredentials, writeStoredCredentials } from './credential-store.server'
import { getSessionEncryptionKey, sealCredentials } from './session-crypto.server'
import type { Credentials } from './validation'

const credentials: Credentials = { accountId: 'a'.repeat(32), authType: 'token', secret: 'test-persistent-token' }
const environment: Credentials = { ...credentials, accountId: 'b'.repeat(32), secret: 'test-environment-token' }

function withStore(run: (path: string, key: Buffer) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'tunnel-credentials-'))
  try { run(join(directory, 'data/credentials.enc'), randomBytes(32)) }
  finally { rmSync(directory, { recursive: true, force: true }) }
}

test('encrypts credentials with owner-only access and replaces the file atomically', () => withStore((path, key) => {
  expect(readStoredCredentials(path, key)).toBeNull()
  writeStoredCredentials(path, key, credentials)
  const contents = readFileSync(path, 'utf8')
  expect(contents).not.toContain(credentials.secret)
  expect(contents).not.toContain(credentials.accountId)
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(readStoredCredentials(path, key)?.credentials).toEqual(credentials)
  writeStoredCredentials(path, key, environment)
  expect(readStoredCredentials(path, key)?.credentials).toEqual(environment)
  expect(readdirSync(join(path, '..'))).toEqual(['credentials.enc'])
  expect(() => writeStoredCredentials(path, key, { ...credentials, secret: '' })).toThrow()
  expect(readStoredCredentials(path, key)?.credentials).toEqual(environment)
}))

test('a fresh process restores the connection without a browser cookie even after a year', () => withStore((path) => {
  const keyPath = join(path, '../session.key')
  const secret = loadSessionSecret(keyPath)
  const original = process.env.SESSION_SECRET
  let key: Buffer
  try {
    process.env.SESSION_SECRET = secret
    key = getSessionEncryptionKey()
  } finally {
    if (original === undefined) delete process.env.SESSION_SECRET
    else process.env.SESSION_SECRET = original
  }
  writeStoredCredentials(path, key, credentials)
  const result = Bun.spawnSync(['bun', '-e', `
    import { loadSessionSecret } from ${JSON.stringify(join(import.meta.dir, '../../server/runtime.ts'))};
    import { getSessionEncryptionKey } from ${JSON.stringify(join(import.meta.dir, 'session-crypto.server.ts'))};
    import { resolveCredentials } from ${JSON.stringify(join(import.meta.dir, 'credential-store.server.ts'))};
    process.env.SESSION_SECRET = loadSessionSecret(process.argv[2]);
    Date.now = () => ${Date.now() + 365 * 24 * 60 * 60 * 1000};
    const saved = resolveCredentials(process.argv[1], getSessionEncryptionKey(), undefined, {});
    process.exit(saved?.source === 'storage' && saved.credentials.secret === 'test-persistent-token' ? 0 : 1);
  `, path, keyPath])
  expect(result.exitCode).toBe(0)
}))

test('migrates a valid legacy cookie once and uses storage over cookies and environment', () => withStore((path, key) => {
  const cookie = sealCredentials(credentials, key)
  expect(resolveCredentials(path, key, cookie, environment)).toEqual({ credentials, source: 'storage' })
  expect(resolveCredentials(path, key, undefined, environment)).toEqual({ credentials, source: 'storage' })
  expect(resolveCredentials(path, key, sealCredentials(environment, key), environment)).toEqual({ credentials, source: 'storage' })
}))

test('disconnect persists and stale browser cookies cannot restore removed credentials', () => withStore((path, key) => {
  const cookie = sealCredentials(credentials, key)
  writeStoredCredentials(path, key, credentials)
  writeStoredCredentials(path, key, null)
  expect(readStoredCredentials(path, key)).toEqual({ credentials: null })
  expect(resolveCredentials(path, key, cookie, {})).toBeNull()
  expect(resolveCredentials(path, key, cookie, environment)).toEqual({ credentials: environment, source: 'environment' })
  writeStoredCredentials(path, key, environment)
  expect(resolveCredentials(path, key, cookie, {})).toEqual({ credentials: environment, source: 'storage' })
}))

test('missing storage falls back to environment while expired and malformed cookies stay disconnected', () => withStore((path, key) => {
  const expired = sealCredentials(credentials, key, 0)
  expect(resolveCredentials(path, key, expired, {})).toBeNull()
  expect(resolveCredentials(path, key, 'invalid', {})).toBeNull()
  expect(resolveCredentials(path, key, undefined, environment)).toEqual({ credentials: environment, source: 'environment' })
  expect(readStoredCredentials(path, key)).toBeNull()
}))

test('unreadable saved credentials produce an error rather than switching accounts silently', () => withStore((path, key) => {
  writeStoredCredentials(path, key, credentials)
  expect(() => readStoredCredentials(path, randomBytes(32))).toThrow('could not be decrypted')
  const contents = Buffer.from(readFileSync(path, 'utf8'), 'base64url')
  contents[contents.length - 1] ^= 1
  writeFileSync(path, contents.toString('base64url'))
  expect(() => resolveCredentials(path, key, sealCredentials(environment, key), environment)).toThrow('Reconnect in Settings')
  writeStoredCredentials(path, key, environment)
  expect(resolveCredentials(path, key, undefined, {})).toEqual({ credentials: environment, source: 'storage' })
}))
