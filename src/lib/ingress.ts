import type { IngressRule } from './types'

// Keep the catch-all last and preserve every existing rule and origin setting.
export function addIngressRule(rules: IngressRule[], rule: IngressRule): IngressRule[] {
  if (rules.some((existing) => existing.hostname === rule.hostname && (existing.path || '') === (rule.path || ''))) {
    throw new Error('A route for this hostname and path already exists.')
  }
  const insertAt = rules.findIndex((existing) => {
    if (!existing.hostname && !existing.path) return true
    const coversHostname = existing.hostname === rule.hostname || (existing.hostname?.startsWith('*.') && rule.hostname?.endsWith(existing.hostname.slice(1)))
    return coversHostname && !existing.path
  })
  const next = [...rules]
  next.splice(insertAt < 0 ? next.length : insertAt, 0, rule)
  if (insertAt < 0) next.push({ service: 'http_status:404' })
  return next
}

export function removeIngressRule(rules: IngressRule[], target: IngressRule): IngressRule[] {
  const index = rules.findIndex((rule) => rule.hostname === target.hostname && (rule.path || '') === (target.path || '') && rule.service === target.service)
  if (index < 0) throw new Error('This route changed or was removed. Refresh and try again.')
  return rules.filter((_, current) => current !== index)
}
