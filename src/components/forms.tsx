import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, Globe2, KeyRound, Plus, ShieldCheck } from 'lucide-react'
import { applicationSchema, buildHostname, credentialsSchema, routeSchema, serviceSchema, type ApplicationInput, type Credentials, type RouteInput, type ServiceInput } from '../lib/validation'
import type { DashboardData, ServicePublishResult } from '../lib/types'
import { getInitialHostname, type HostnameInput } from '../lib/hostnames'
import { ExternalLink, Spinner } from './ui'

export function Field({ label, optional, hint, children }: { label: string; optional?: boolean; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}{optional && <span>Optional</span>}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>
}

function HostnameFields({ value, onChange, zones, route = false }: { value: HostnameInput; onChange: (value: HostnameInput) => void; zones: DashboardData['zones']; route?: boolean }) {
  return <>
    <div className="hostname-fields"><Field label="Subdomain" optional><input value={value.subdomain} onChange={(event) => onChange({ ...value, subdomain: event.target.value })} placeholder="photos" autoCapitalize="none" /></Field><span className="hostname-dot">.</span><Field label="Domain"><select value={value.domain} onChange={(event) => onChange({ ...value, domain: event.target.value })} required><option value="" disabled>Select domain</option>{zones.map((zone) => <option key={zone.id} value={zone.name}>{zone.name}</option>)}</select></Field></div>
    <Field label="Path" optional hint={route ? 'Cloudflared path expression. Leave empty to match all paths.' : 'Leave empty for the entire hostname. A path also covers its subpaths.'}><input value={value.path} onChange={(event) => onChange({ ...value, path: event.target.value })} placeholder="/" /></Field>
    <div className="hostname-preview mono"><Globe2 size={14} />{buildHostname(value) || 'your-domain.com'}{value.path}</div>
  </>
}

export function PolicyCheckboxes({ policies, selected, onChange, protectedService }: { policies: DashboardData['policies']; selected: string[]; onChange: (ids: string[]) => void; protectedService: boolean }) {
  return <>
    <div className="form-section-label policy-heading">ACCESS POLICIES<span>{selected.length} selected</span></div>
    {policies.length ? <div className="policy-options">{policies.map((policy) => {
      const disabled = protectedService && policy.decision === 'bypass'
      const order = selected.indexOf(policy.id) + 1
      return <label className={`policy-option ${order ? 'checked' : ''} ${disabled ? 'unavailable' : ''}`} key={policy.id} title={disabled ? 'Bypass policies do not protect a service.' : undefined}><input type="checkbox" checked={Boolean(order)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...selected, policy.id] : selected.filter((id) => id !== policy.id))} />{order ? <span className="policy-order" aria-label={`Selection ${order}`}>{order}</span> : <ShieldCheck size={16} />}<span className="policy-name">{policy.name}</span><span className="decision">{policy.decision === 'non_identity' ? 'Service auth' : policy.decision}</span></label>
    })}</div> : <p className="form-hint">No reusable policies found. Create a policy in Cloudflare first.</p>}
    {selected.length > 0 && <ol className="selected-policy-order" aria-label="Policy selection order">{selected.map((id) => <li key={id}>{policies.find((policy) => policy.id === id)?.name || id}</li>)}</ol>}
    <p className="form-hint">Policies are evaluated in the order selected. Session duration: 24 hours.</p>
  </>
}

export type ResourceInput = ApplicationInput | RouteInput | ServiceInput

export function ResourceForm({ kind, data, initialTunnelId, initialHostname, initialPath, initialService, initialError = '', onSubmit, onCancel, pending }: {
  kind: 'route' | 'application' | 'service'; data: DashboardData; initialTunnelId?: string; initialHostname?: string; initialPath?: string
  initialService?: ServiceInput; initialError?: string
  onSubmit: (input: ResourceInput) => Promise<ServicePublishResult | void>; onCancel: () => void; pending: boolean
}) {
  const [hostname, setHostname] = useState(() => initialService ? { subdomain: initialService.subdomain, domain: initialService.domain, path: initialService.path } : getInitialHostname(data.zones, initialHostname, initialPath))
  const [routeHostname, setRouteHostname] = useState(initialService?.routeHostname || hostname)
  const [reuseHostname, setReuseHostname] = useState(!initialService?.routeHostname)
  const [name, setName] = useState(initialService?.name || '')
  const [policyIds, setPolicyIds] = useState<string[]>(initialService?.policyIds || [])
  const [applicationId, setApplicationId] = useState(initialService?.applicationId)
  const [error, setError] = useState(initialError)
  const hasApplication = kind !== 'route'
  const hasRoute = kind !== 'application'
  const remoteTunnels = data.tunnels.filter((tunnel) => tunnel.remote && !tunnel.error)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const application = { ...hostname, name, policyIds }
    const route = { ...hostname, tunnelId: String(values.get('tunnelId') || ''), service: String(values.get('service') || ''), createDns: values.get('createDns') === 'on' }
    const input = kind === 'application' ? application : kind === 'route' ? route : { ...route, ...application, ...(reuseHostname ? {} : { routeHostname }), ...(applicationId ? { applicationId } : {}) }
    const parsed = (kind === 'application' ? applicationSchema : kind === 'route' ? routeSchema : serviceSchema).safeParse(input)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || 'Check the form.'); return }
    setError('')
    try {
      const result = await onSubmit(parsed.data)
      if (result?.status === 'application_only') {
        setApplicationId(result.applicationId)
        setError(result.error)
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t save. Try again.') }
  }

  const tunnelDropdown = <Field label="Tunnel"><select name="tunnelId" defaultValue={initialService?.tunnelId || remoteTunnels.find((tunnel) => tunnel.id === initialTunnelId)?.id || remoteTunnels[0]?.id || ''} disabled={pending || !remoteTunnels.length} required>{!remoteTunnels.length && <option value="">No remotely managed tunnels</option>}{remoteTunnels.map((tunnel) => <option key={tunnel.id} value={tunnel.id}>{tunnel.name}</option>)}</select></Field>

  return <form onSubmit={submit} className="resource-form">
    <div className={`form-body ${kind === 'service' ? 'service-form-body' : ''}`}>
      <div className="resource-type">{hasApplication ? <ShieldCheck size={17} /> : <Globe2 size={17} />}<span>{kind === 'service' ? 'Access application → tunnel route' : kind === 'route' ? 'Published application' : 'Self-hosted application'}</span><Check size={15} /></div>
      {kind === 'route' && tunnelDropdown}
      <fieldset className="form-fieldset" disabled={pending || Boolean(applicationId)}>
        {hasApplication && <Field label="Application name"><input name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Immich" required maxLength={100} autoFocus /></Field>}
        <div className="form-section-label">PUBLIC HOSTNAME</div>
        <HostnameFields value={hostname} onChange={setHostname} zones={data.zones} route={kind === 'route'} />
        {hasApplication && <PolicyCheckboxes policies={data.policies} selected={policyIds} onChange={setPolicyIds} protectedService={kind === 'service'} />}
      </fieldset>
      {hasRoute && <section className="service-route-panel">
      {kind === 'service' && <>
        <div className="form-section-label">TUNNEL ROUTE</div>
        {tunnelDropdown}
        <fieldset className="form-fieldset" disabled={pending || Boolean(applicationId)}>
          <label className="checkbox-label reuse-hostname"><input type="checkbox" checked={reuseHostname} onChange={(event) => {
            setReuseHostname(event.target.checked)
            if (!event.target.checked) setRouteHostname(hostname)
          }} /><span>Reuse subdomain, domain, and path</span></label>
          {reuseHostname ? <div className="hostname-preview mono reused-hostname"><Globe2 size={14} />{buildHostname(hostname) || 'your-domain.com'}{hostname.path}</div> : <div className="route-hostname-fields"><HostnameFields value={routeHostname} onChange={setRouteHostname} zones={data.zones} /><p className="form-hint">Both destinations will be added to the Access application.</p></div>}
        </fieldset>
      </>}
        <div className="form-section-label">ORIGIN SERVICE</div><Field label="Service URL"><input name="service" defaultValue={initialService?.service} placeholder="http://localhost:3000" required disabled={pending} autoComplete="off" autoFocus={Boolean(applicationId)} /></Field>
        <label className="checkbox-label dns-checkbox"><input type="checkbox" name="createDns" defaultChecked={initialService?.createDns ?? true} disabled={pending} /><span>Create DNS record<small>Proxied CNAME pointing to this tunnel.</small></span></label>
      </section>}
      {kind === 'service' && <p className="form-hint service-order-note">{applicationId ? 'Access application created. Retry to finish publishing the route.' : 'The Access application and policies are verified before DNS and the route are published.'}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <footer className="modal-footer">{data.mode === 'demo' && <span className="demo-note">Demo changes only</span>}<button type="button" className="button secondary" onClick={onCancel} disabled={pending}>Cancel</button><button className="button primary" disabled={pending || !hostname.domain || (hasRoute && !remoteTunnels.length) || (hasApplication && !policyIds.length)}>{pending ? <Spinner /> : <Plus size={15} />}{kind === 'service' ? applicationId ? 'Retry route' : 'Create service' : kind === 'route' ? 'Add route' : 'Create application'}</button></footer>
  </form>
}

export function ConnectionForm({ onConnect, pending, error }: { onConnect: (credentials: Credentials) => Promise<void>; pending: boolean; error: string }) {
  const [authType, setAuthType] = useState<'token' | 'key'>('token')
  const [validationError, setValidationError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const parsed = credentialsSchema.safeParse({ authType, accountId: values.get('accountId'), secret: values.get('secret'), email: values.get('email') || undefined })
    if (!parsed.success) { setValidationError(parsed.error.issues[0]?.message || 'Check your credentials.'); return }
    setValidationError('')
    await onConnect(parsed.data)
  }
  return <form className="connection-form" onSubmit={submit}>
    <div className="settings-card-heading"><span className="settings-icon"><KeyRound size={20} /></span><div><h2>Connect Cloudflare</h2><p>Use an API token or your global API key.</p></div></div>
    <div className="auth-tabs"><button type="button" aria-pressed={authType === 'token'} className={authType === 'token' ? 'active' : ''} onClick={() => setAuthType('token')}>API token</button><button type="button" aria-pressed={authType === 'key'} className={authType === 'key' ? 'active' : ''} onClick={() => setAuthType('key')}>Global API key</button></div>
    <Field label="Account ID" hint="Cloudflare dashboard → account homepage → Account ID."><input name="accountId" placeholder="32-character account ID" required autoComplete="off" disabled={pending} /></Field>
    {authType === 'key' && <Field label="Account email"><input name="email" type="email" placeholder="you@example.com" autoComplete="email" required disabled={pending} /></Field>}
    <Field label={authType === 'token' ? 'API token' : 'Global API key'}><input name="secret" type="password" placeholder={authType === 'token' ? 'Cloudflare API token' : 'Cloudflare global API key'} autoComplete="off" required disabled={pending} /></Field>
    {authType === 'token' && <div className="permissions"><span>Token permissions</span><p>Account: Cloudflare Tunnel · Edit<br />Account: Access: Apps and Policies · Edit<br />Zone: Zone · Read<br />Zone: DNS · Edit <span>(for DNS creation)</span></p></div>}
    {(error || validationError) && <p className="form-error" role="alert">{validationError || error}</p>}
    <div className="connect-footer"><ExternalLink href="https://dash.cloudflare.com/profile/api-tokens">Manage API tokens</ExternalLink><button className="button primary" disabled={pending}>{pending ? <Spinner /> : null}Connect account<ArrowRight size={15} /></button></div>
    <p className="form-hint credential-note">Credentials are encrypted and saved on this dashboard until disconnected. Shared by everyone who can access it.</p>
  </form>
}
