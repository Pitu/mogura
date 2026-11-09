import type { ApplicationInput, RouteInput, ServiceInput } from './validation'
import { buildHostname } from './validation'

export type HostnameInput = Pick<ApplicationInput, 'subdomain' | 'domain' | 'path'>

export function getInitialHostname(zones: { name: string }[], hostname?: string, path = ''): HostnameInput {
  const matchingZone = [...zones].sort((left, right) => right.name.length - left.name.length).find((zone) => hostname === zone.name || hostname?.endsWith(`.${zone.name}`))
  const domain = matchingZone?.name || zones[0]?.name || ''
  return { domain, subdomain: hostname ? hostname === domain ? '' : hostname.slice(0, -(domain.length + 1)) : '', path }
}

export function serviceDestinations(input: ServiceInput): string[] {
  const route = input.routeHostname || input
  return [...new Set([buildHostname(input) + input.path, buildHostname(route) + route.path])]
}

export function serviceRoute(input: ServiceInput): RouteInput {
  const hostname = input.routeHostname || input
  // Access paths cover the exact path and its descendants. Anchor cloudflared's
  // regex so /admin cannot accidentally publish /administrator without Access.
  return {
    ...hostname,
    path: ingressPathForAccess(hostname.path),
    tunnelId: input.tunnelId,
    service: input.service,
    createDns: input.createDns,
  }
}

function ingressPathForAccess(path: string): string {
  const prefix = path.replace(/\/$/, '')
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return prefix ? `^${escaped}(/.*)?$` : ''
}

export function accessPathForRoute(path: string): string {
  const suffix = '(/.*)?$'
  if (!path.startsWith('^') || !path.endsWith(suffix)) return path
  const candidate = path.slice(1, -suffix.length).replace(/\\([.*+?^${}()|[\]\\])/g, '$1')
  return ingressPathForAccess(candidate) === path ? candidate : path
}
