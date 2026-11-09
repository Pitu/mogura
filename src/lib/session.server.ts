import { deleteCookie, getCookie } from '@tanstack/react-start/server'
import { getSessionEncryptionKey } from './session-crypto.server'
import { credentialStorePath, resolveCredentials, saveDeploymentCredentials } from './credential-store.server'
import type { Credentials } from './validation'

const cookieName = 'tunnel_session'

export function saveCredentials(credentials: Credentials) {
  saveDeploymentCredentials(credentials)
  deleteCookie(cookieName, { path: '/' })
}

export function clearCredentials() {
  saveDeploymentCredentials(null)
  deleteCookie(cookieName, { path: '/' })
}

export function readCredentials() {
  return resolveCredentials(credentialStorePath(), getSessionEncryptionKey(), getCookie(cookieName), { accountId: process.env.CLOUDFLARE_ACCOUNT_ID, authType: process.env.CLOUDFLARE_API_TOKEN ? 'token' : 'key', secret: process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY, email: process.env.CLOUDFLARE_EMAIL })
}
