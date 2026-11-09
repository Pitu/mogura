import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { join } from 'node:path'
import { loadSessionSecret } from '../../server/runtime'
import { credentialsSchema, type Credentials } from './validation'

export const sessionLifetime = 60 * 60 * 8

export function getSessionEncryptionKey() {
  const secret = process.env.SESSION_SECRET || loadSessionSecret(process.env.SESSION_SECRET_FILE || join(process.cwd(), '.data/session.key'))
  return createHash('sha256').update(secret).digest()
}

const sessionSchema = z.object({ credentials: credentialsSchema, expires: z.number() })

function encrypt(value: unknown, key: Buffer) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}

function decrypt(cookie: string, key: Buffer): unknown {
  const value = Buffer.from(cookie, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
  decipher.setAuthTag(value.subarray(12, 28))
  const plaintext = Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString()
  return JSON.parse(plaintext)
}

export function sealCredentials(credentials: Credentials, key: Buffer, now = Date.now()) {
  return encrypt({ credentials, expires: now + sessionLifetime * 1000 }, key)
}

export function openCredentials(cookie: string, key: Buffer, now = Date.now()): Credentials | null {
  try {
    const result = sessionSchema.safeParse(decrypt(cookie, key))
    return result.success && result.data.expires > now ? result.data.credentials : null
  } catch { return null }
}

const storedCredentialsSchema = z.object({ version: z.literal(1), credentials: credentialsSchema.nullable() })
function storageKey(key: Buffer) { return createHash('sha256').update('tunnel.credentials.v1').update(key).digest() }

export function sealStoredCredentials(credentials: Credentials | null, key: Buffer) {
  return encrypt(storedCredentialsSchema.parse({ version: 1, credentials }), storageKey(key))
}

export function openStoredCredentials(value: string, key: Buffer): { credentials: Credentials | null } {
  try {
    const { credentials } = storedCredentialsSchema.parse(decrypt(value, storageKey(key)))
    return { credentials }
  }
  catch { throw new Error('Saved credentials could not be decrypted. Reconnect in Settings to replace them.') }
}
