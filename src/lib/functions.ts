import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { applicationSchema, credentialsSchema, removeRouteSchema, routeSchema, serviceSchema } from './validation'

export const getDashboard = createServerFn({ method: 'GET' }).handler(async () => {
  const { readCredentials } = await import('./session.server')
  const session = readCredentials()
  if (!session) return null
  const { CloudflareApi } = await import('./cloudflare.server')
  const result = await new CloudflareApi(session.credentials).snapshot()
  return { ...result, source: session.source }
})

export const connectCloudflare = createServerFn({ method: 'POST' }).validator(credentialsSchema).handler(async ({ data }) => {
  const { CloudflareApi } = await import('./cloudflare.server')
  const { saveCredentials } = await import('./session.server')
  const result = await new CloudflareApi(data).snapshot()
  saveCredentials(data)
  return { ...result, source: 'storage' as const }
})

export const disconnectCloudflare = createServerFn({ method: 'POST' }).handler(async () => {
  const { clearCredentials } = await import('./session.server')
  clearCredentials()
})

async function authenticatedApi() {
  const { readCredentials } = await import('./session.server')
  const session = readCredentials()
  if (!session) throw new Error('Connect your Cloudflare account first.')
  const { CloudflareApi } = await import('./cloudflare.server')
  return new CloudflareApi(session.credentials)
}

export const createApplication = createServerFn({ method: 'POST' }).validator(applicationSchema).handler(async ({ data }) => {
  await (await authenticatedApi()).createApplication(data)
})

export const publishService = createServerFn({ method: 'POST' }).validator(serviceSchema).handler(async ({ data }) => {
  return (await authenticatedApi()).publishService(data)
})
export const removeApplication = createServerFn({ method: 'POST' }).validator(z.object({ id: z.uuid() })).handler(async ({ data }) => {
  await (await authenticatedApi()).removeApplication(data.id)
})
export const addRoute = createServerFn({ method: 'POST' }).validator(routeSchema).handler(async ({ data }) => {
  await (await authenticatedApi()).addRoute(data)
})
export const removeRoute = createServerFn({ method: 'POST' }).validator(removeRouteSchema).handler(async ({ data }) => {
  await (await authenticatedApi()).removeRoute(data)
})
