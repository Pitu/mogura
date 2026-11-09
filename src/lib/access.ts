import type { AccessApplication, IngressRule } from './types'
import { accessPathForRoute } from './hostnames'

// A badge means a matching Access application exists, not that its policy blocks everyone.
export function findApplication(route: IngressRule, applications: AccessApplication[]) {
  const routePath = accessPathForRoute(route.path || '')
  const target = `${route.hostname || ''}${routePath}`
  return applications.find((app) => (app.destinations.length ? app.destinations : [app.domain]).some((destination) => {
    const slash = destination.indexOf('/')
    const hostname = slash < 0 ? destination : destination.slice(0, slash)
    const path = slash < 0 ? '' : destination.slice(slash)
    const hostMatches = hostname === route.hostname || (hostname.startsWith('*.') && Boolean(route.hostname?.endsWith(hostname.slice(1))))
    const prefix = path.replace(/\*$/, '').replace(/\/$/, '')
    const isLiteralPath = !/[|()[\]{}+?^$]/.test(routePath)
    return hostMatches && (!path || target === destination || (isLiteralPath && (routePath === prefix || routePath.startsWith(`${prefix}/`))))
  }))
}

export function visibleRoutes(routes: IngressRule[]) { return routes.filter((route) => Boolean(route.hostname)) }
