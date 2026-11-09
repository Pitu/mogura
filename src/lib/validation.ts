import { z } from 'zod'

export const credentialsSchema = z.object({
  accountId: z.string().regex(/^[a-f0-9]{32}$/i, 'Enter a valid 32-character Cloudflare account ID.'),
  authType: z.enum(['token', 'key']),
  secret: z.string().trim().min(10, 'Enter your API token or key.').max(512),
  email: z.string().trim().optional(),
}).refine((value) => value.authType !== 'key' || z.email().safeParse(value.email).success, { message: 'An email address is required for a global API key.', path: ['email'] })

const hostnameFields = {
  subdomain: z.string().trim().max(200).refine((value) => !value || value.split('.').every((label, index) => (index === 0 && label === '*') || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)), 'Use a valid subdomain.'),
  domain: z.string().trim().min(3).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i, 'Choose a valid domain.'),
  path: z.string().trim().max(1000).refine((value) => !value || value.startsWith('/'), 'Paths must start with /.').default(''),
}

export const applicationSchema = z.object({
  ...hostnameFields,
  name: z.string().trim().min(1, 'Enter an application name.').max(100),
  policyIds: z.array(z.uuid()).min(1, 'Select at least one policy.').max(50),
})

export const routeSchema = z.object({
  ...hostnameFields,
  tunnelId: z.uuid(),
  service: z.string().trim().max(2048).refine((value) => {
    try { const url = new URL(value); return ['http:', 'https:', 'tcp:', 'ssh:', 'rdp:', 'smb:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password } catch { return false }
  }, 'Enter a service URL, such as http://localhost:3000.'),
  createDns: z.boolean(),
})

export const removeRouteSchema = z.object({
  tunnelId: z.uuid(),
  hostname: z.string().min(1),
  path: z.string(),
  service: z.string().min(1),
})

export const serviceSchema = applicationSchema.extend({
  tunnelId: routeSchema.shape.tunnelId,
  service: routeSchema.shape.service,
  createDns: routeSchema.shape.createDns,
  routeHostname: z.object(hostnameFields).optional(),
  applicationId: z.uuid().optional(),
}).superRefine((input, context) => {
  for (const [path, location] of [[input.path, ['path']], [input.routeHostname?.path, ['routeHostname', 'path']]] as const) {
    if (path && /[\\^$*+?()[\]{}|#]/.test(path)) context.addIssue({ code: 'custom', path: [...location], message: 'Use a literal path for this flow, such as /admin. Regex and wildcards are available in the separate route form.' })
  }
})

export type Credentials = z.infer<typeof credentialsSchema>
export type ApplicationInput = z.infer<typeof applicationSchema>
export type RouteInput = z.infer<typeof routeSchema>
export type RemoveRouteInput = z.infer<typeof removeRouteSchema>
export type ServiceInput = z.infer<typeof serviceSchema>

export function buildHostname(input: { subdomain: string; domain: string }) {
  return [input.subdomain, input.domain].filter(Boolean).join('.').toLowerCase()
}
