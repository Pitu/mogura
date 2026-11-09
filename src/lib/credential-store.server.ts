import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getSessionEncryptionKey, openCredentials, openStoredCredentials, sealStoredCredentials } from './session-crypto.server'
import { credentialsSchema, type Credentials } from './validation'

export function credentialStorePath() { return process.env.CREDENTIALS_FILE || join(process.cwd(), '.data/credentials.enc') }

export function readStoredCredentials(path: string, key: Buffer): { credentials: Credentials | null } | null {
  let value: string
  try { value = readFileSync(path, 'utf8') }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw new Error('Saved credentials could not be read. Check the data directory permissions.')
  }
  return openStoredCredentials(value, key)
}

export function writeStoredCredentials(path: string, key: Buffer, credentials: Credentials | null) {
  const value = sealStoredCredentials(credentials, key)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${randomBytes(12).toString('hex')}.tmp`
  try {
    writeFileSync(temporaryPath, value, { flag: 'wx', mode: 0o600 })
    renameSync(temporaryPath, path)
  } finally { rmSync(temporaryPath, { force: true }) }
}

export function resolveCredentials(path: string, key: Buffer, cookie: string | undefined, environment: unknown): { credentials: Credentials; source: 'storage' | 'environment' } | null {
  const stored = readStoredCredentials(path, key)
  if (stored?.credentials) return { credentials: stored.credentials, source: 'storage' }
  // A saved disconnection prevents old cookies in other browsers from restoring
  // credentials that were deliberately removed from this deployment.
  if (!stored && cookie) {
    const credentials = openCredentials(cookie, key)
    if (credentials) {
      writeStoredCredentials(path, key, credentials)
      return { credentials, source: 'storage' }
    }
  }
  const parsed = credentialsSchema.safeParse(environment)
  return parsed.success ? { credentials: parsed.data, source: 'environment' } : null
}

export function saveDeploymentCredentials(credentials: Credentials | null) {
  writeStoredCredentials(credentialStorePath(), getSessionEncryptionKey(), credentials)
}
