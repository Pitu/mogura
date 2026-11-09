import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Box, Check, ChevronDown, ChevronRight, CircleHelp, Cloud, Copy, Globe2, LayoutGrid, List, MoreHorizontal, Plus, RefreshCw, Search, Settings2, Shield, ShieldCheck, SlidersHorizontal, Trash2, Unplug, X } from 'lucide-react'
import { createDemoApplication, createDemoId } from '../lib/demo'
import * as api from '../lib/functions'
import { findApplication, visibleRoutes } from '../lib/access'
import { serviceDestinations, serviceRoute } from '../lib/hostnames'
import { addIngressRule, removeIngressRule } from '../lib/ingress'
import { buildHostname, type Credentials, type ServiceInput } from '../lib/validation'
import { useMediaQuery } from '../lib/use-media-query'
import type { AccessApplication, DashboardData, IngressRule, ServicePublishResult, Tunnel, TunnelDiscovery } from '../lib/types'
import { ConnectionForm, ResourceForm, type ResourceInput } from './forms'
import { TunnelMap } from './tunnel-map'
import { Empty, ExternalLink, Modal, Spinner, Status, TunnelMark } from './ui'

export type View = 'tunnels' | 'applications' | 'policies' | 'settings'
type Dialog = { kind: 'service-form' } | { kind: 'route-form'; hostname?: string } | { kind: 'application-form'; hostname?: string; path?: string } | { kind: 'route-detail'; route: IngressRule } | { kind: 'remove-route'; route: IngressRule } | { kind: 'application-detail'; application: AccessApplication } | { kind: 'remove-application'; application: AccessApplication } | { kind: 'tunnel-detail' } | null

const disconnectedData: DashboardData = { mode: 'live', accountId: '', tunnels: [], applications: [], policies: [], zones: [], fetchedAt: '' }

const viewTitles: Record<View, string> = { tunnels: 'Tunnels', applications: 'Access applications', policies: 'Access policies', settings: 'Settings' }

export function Dashboard({ initialData, initialError, view: requestedView, onViewChange }: { initialData: DashboardData | null; initialError: string; view: View; onViewChange: (view: View) => void }) {
  const [data, setData] = useState<DashboardData>(initialData || disconnectedData)
  const [selectedTunnelId, setSelectedTunnelId] = useState(data.tunnels[0]?.id || '')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [search, setSearch] = useState('')
  const isNarrow = useMediaQuery('(max-width: 700px)')
  const [layoutPreference, setLayoutPreference] = useState<'map' | 'list' | null>(null)
  const layout = layoutPreference || (isNarrow ? 'list' : 'map')
  const [unfinishedService, setUnfinishedService] = useState<{ input: ServiceInput; error: string } | null>(null)
  const [accessFilter, setAccessFilter] = useState('all')
  const [pending, setPending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(initialError)
  const [connectionError, setConnectionError] = useState('')
  const [sessionExpired, setSessionExpired] = useState(false)
  const [toast, setToast] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sortAscending, setSortAscending] = useState(true)
  const searchRef = useRef<HTMLInputElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const connected = data.mode === 'demo' || Boolean(data.accountId)
  const view = connected ? requestedView : 'settings'
  const tunnel = data.tunnels.find((item) => item.id === selectedTunnelId) || data.tunnels[0]
  const tunnelLoadFailed = data.tunnelDiscovery?.state === 'error'
  const totalRoutes = data.tunnels.reduce((count, item) => count + visibleRoutes(item.routes).length, 0)
  const healthyCount = data.tunnels.filter((item) => item.status === 'healthy').length
  const query = search.toLowerCase().trim()
  const routes = visibleRoutes(tunnel?.routes || []).filter((route) => {
    const app = findApplication(route, data.applications)
    return `${route.hostname} ${route.path || ''} ${route.service}`.toLowerCase().includes(query) && (accessFilter === 'all' || (accessFilter === 'access' ? Boolean(app) : !app))
  })
  const applications = data.applications.filter((app) => `${app.name} ${app.domain}`.toLowerCase().includes(query)).sort((a, b) => (sortAscending ? 1 : -1) * a.name.localeCompare(b.name))

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('tunnel.route-layout')
      if (saved === 'map' || saved === 'list') setLayoutPreference(saved)
    } catch { /* A blocked preference store should not block the dashboard. */ }
  }, [])
  useEffect(() => {
    if (!isNarrow || !sidebarOpen) return
    const sidebar = sidebarRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || [])
    const initial = sidebar?.querySelector<HTMLElement>('[aria-current="page"]') || focusable()[0]
    initial?.focus()
    function drawerKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false) }
      if (event.key !== 'Tab') return
      const items = focusable()
      const next = event.shiftKey ? items.at(-1) : items[0]
      const edge = event.shiftKey ? items[0] : items.at(-1)
      if (document.activeElement === edge || !sidebar?.contains(document.activeElement)) {
        event.preventDefault(); next?.focus()
      }
    }
    document.addEventListener('keydown', drawerKeydown)
    return () => {
      document.removeEventListener('keydown', drawerKeydown)
      document.body.style.overflow = previousOverflow
      menuRef.current?.focus()
    }
  }, [isNarrow, sidebarOpen])

  function setLayout(next: 'map' | 'list') {
    setLayoutPreference(next)
    try { window.localStorage.setItem('tunnel.route-layout', next) } catch { /* Keep the preference for this tab. */ }
  }

  function changeView(next: View) { onViewChange(next); setSearch(''); setSidebarOpen(false) }
  function closeDialog() { if (!pending) setDialog(null) }

  async function refresh() {
    setRefreshing(true)
    try {
      const next = await api.getDashboard()
      if (next) {
        if (next.accountId !== data.accountId) setUnfinishedService(null)
        setData(next); setSessionExpired(false); setSelectedTunnelId((current) => current || next.tunnels[0]?.id || '')
      }
      else if (data.mode === 'live') {
        setSessionExpired(true)
        setError('Connection unavailable. Reconnect in Settings to continue.')
        setDialog(null)
        changeView('settings')
        return
      }
      setError('')
      if (data.mode === 'demo' && !next) setToast('Demo data refreshed')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t refresh Cloudflare data.') }
    finally { setRefreshing(false) }
  }

  async function mutate(action: () => Promise<void>, demoUpdate: (current: DashboardData) => DashboardData, message: string) {
    if (sessionExpired) throw new Error('Reconnect in Settings before making changes.')
    setPending(true)
    try {
      if (data.mode === 'demo') setData(demoUpdate)
      else await action()
      setDialog(null)
      setToast(data.mode === 'demo' ? `${message} · demo` : message)
      if (data.mode === 'live') await refresh()
    } finally { setPending(false) }
  }

  async function saveResource(input: ResourceInput): Promise<ServicePublishResult | void> {
    if ('name' in input && 'service' in input) {
      if (sessionExpired) throw new Error('Reconnect in Settings before making changes.')
      setPending(true)
      try {
        let result: ServicePublishResult
        if (data.mode === 'demo') {
          const applicationId = createDemoId()
          const route = serviceRoute(input)
          const rule = { hostname: buildHostname(route), path: route.path, service: route.service }
          addIngressRule(data.tunnels.find((item) => item.id === route.tunnelId)?.routes || [], rule)
          const application = createDemoApplication(input, applicationId, data.policies, serviceDestinations(input))
          setData((current) => ({ ...current, applications: [...current.applications, application], tunnels: current.tunnels.map((item) => item.id === route.tunnelId ? { ...item, routes: addIngressRule(item.routes, rule) } : item) }))
          result = { status: 'published', applicationId }
        } else {
          result = await api.publishService({ data: input })
          if (result.status === 'application_only') setUnfinishedService({ input: { ...input, applicationId: result.applicationId }, error: result.error })
          await refresh()
        }
        if (result.status === 'published') {
          setUnfinishedService(null)
          setDialog(null)
          setToast(data.mode === 'demo' ? 'Service created · demo' : 'Service created')
        }
        return result
      } finally { setPending(false) }
    }
    if ('service' in input) {
      const hostname = buildHostname(input)
      const rule: IngressRule = { hostname, service: input.service, ...(input.path ? { path: input.path } : {}) }
      // Validate duplicate routes before either local or remote changes.
      addIngressRule(data.tunnels.find((item) => item.id === input.tunnelId)?.routes || [], rule)
      await mutate(() => api.addRoute({ data: input }), (current) => ({ ...current, tunnels: current.tunnels.map((item) => item.id === input.tunnelId ? { ...item, routes: addIngressRule(item.routes, rule) } : item) }), 'Route added')
    } else {
      await mutate(() => api.createApplication({ data: input }), (current) => ({ ...current, applications: [...current.applications, createDemoApplication(input, createDemoId(), current.policies)] }), 'Application created')
    }
  }

  async function connect(credentials: Credentials) {
    setPending(true); setConnectionError('')
    try {
      const next = await api.connectCloudflare({ data: credentials })
      setSessionExpired(false); setUnfinishedService(null); setData(next); setSelectedTunnelId(next.tunnels[0]?.id || ''); setError(''); setToast('Cloudflare connected'); changeView('tunnels')
    } catch (failure) { setConnectionError(failure instanceof Error ? failure.message : 'Couldn’t connect to Cloudflare.') }
    finally { setPending(false) }
  }

  async function disconnect() {
    setPending(true)
    try {
      await api.disconnectCloudflare()
      const next = await api.getDashboard()
      setSessionExpired(false); setUnfinishedService(null); setData(next || disconnectedData); setSelectedTunnelId(next?.tunnels[0]?.id || ''); setError(''); setDialog(null); changeView('settings'); setToast(next ? 'Using environment credentials' : 'Saved account removed')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t disconnect.') }
    finally { setPending(false) }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setToast('Copied to clipboard') } catch { setToast('Clipboard unavailable') }
  }

  const navigateItems = [
    { view: 'tunnels' as const, icon: TunnelMark, label: 'Tunnels', count: tunnelLoadFailed ? '?' : data.tunnels.length },
    { view: 'applications' as const, icon: ShieldCheck, label: 'Applications', count: data.applications.length },
    { view: 'policies' as const, icon: SlidersHorizontal, label: 'Policies', count: data.policies.length },
  ]

  return <div className="app-shell">
    {sidebarOpen && <button className="sidebar-backdrop" tabIndex={-1} aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside ref={sidebarRef} id="workspace-navigation" className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} inert={isNarrow && !sidebarOpen} aria-label="Navigation">
      <button className="icon-button drawer-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={19} /></button>
      <a className="brand" href="/?view=tunnels" onClick={(event) => { event.preventDefault(); changeView('tunnels') }}><span className="brand-mark"><TunnelMark size={23} /></span>mogura<span className="brand-dot">.</span></a>
      <nav aria-label="Main navigation">{navigateItems.map((item) => <button key={item.view} className={`nav-item ${view === item.view ? 'active' : ''}`} disabled={!connected} aria-current={view === item.view ? 'page' : undefined} onClick={() => changeView(item.view)}><item.icon size={18} /><span>{item.label}</span>{connected && <span className="nav-count">{item.count}</span>}</button>)}</nav>
      <div className="sidebar-bottom">
        <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => changeView('settings')}><Settings2 size={18} /><span>Settings</span></button>
        <a className="nav-item" href="https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/" target="_blank" rel="noreferrer"><CircleHelp size={18} /><span>Documentation</span><ArrowUpRight size={14} /></a>
      </div>
    </aside>

    <div className="main-shell" inert={isNarrow && sidebarOpen}>
      <header className="mobile-topbar"><button ref={menuRef} className="icon-button" aria-expanded={sidebarOpen} aria-controls="workspace-navigation" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><List size={20} /></button><span>mogura.</span></header>
      <main className="main-content">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={refresh} disabled={refreshing}>Retry</button><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
        <div className="page-heading"><div><h1>{viewTitles[view]}</h1></div><div className="heading-actions">{view !== 'settings' && <button className="button secondary refresh-button" onClick={refresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'spin' : ''} /><span>Refresh</span></button>}{view === 'tunnels' && <button className="button secondary" disabled={!tunnel?.remote || Boolean(tunnel?.error)} onClick={() => setDialog({ kind: 'route-form' })}><Plus size={16} />Add route</button>}{view === 'applications' && <button className="button secondary" onClick={() => setDialog({ kind: 'application-form' })}><Plus size={16} />New application</button>}{(view === 'tunnels' || view === 'applications') && <button className="button primary" disabled={sessionExpired || !data.tunnels.some((item) => item.remote && !item.error)} onClick={() => setDialog({ kind: 'service-form' })}><Plus size={16} />{unfinishedService ? 'Resume service' : 'New service'}</button>}</div></div>

        {unfinishedService && <section className="resume-banner" aria-label="Unfinished service" role="status"><ShieldCheck size={19} /><div><strong>{unfinishedService.input.name}</strong><p>Access application saved. Route still needs publishing.</p></div><button className="button secondary" disabled={pending || sessionExpired} onClick={() => setDialog({ kind: 'service-form' })}>Resume service<ArrowRight size={14} /></button><button className="icon-button" disabled={pending} aria-label="Dismiss reminder; keep the Access application" title="Dismiss reminder. The Access application stays in place." onClick={() => setUnfinishedService(null)}><X size={16} /></button></section>}

        {data.mode === 'demo' && view !== 'settings' && <div className="demo-banner"><span className="demo-banner-icon"><Box size={15} /></span><p>You’re viewing example data.<span> Connect your account to manage your tunnels.</span></p><button onClick={() => changeView('settings')}>Connect Cloudflare<ArrowRight size={14} /></button></div>}

        {view === 'tunnels' && <>
          <div className="network-summary"><span><TunnelMark size={14} /><strong>{tunnelLoadFailed ? '?' : data.tunnels.length}</strong> tunnels</span><span className="summary-separator" /><span><Globe2 size={14} /><strong>{tunnelLoadFailed ? '?' : totalRoutes}</strong> published routes</span><span className="summary-separator" /><span><ShieldCheck size={14} /><strong>{data.applications.length}</strong> Access applications</span>{!tunnelLoadFailed && <span className="summary-right"><i className={healthyCount ? 'connection-dot' : 'muted-dot'} />{healthyCount} healthy{data.tunnels.length > healthyCount && <> · {data.tunnels.length - healthyCount} {data.tunnels.some((item) => item.status === 'degraded' || item.status === 'down') ? 'need attention' : 'inactive'}</>}</span>}</div>
          <section className="network-panel" aria-label="Tunnel network">
            <div className="network-toolbar"><div className="tunnel-tabs" role="tablist" aria-label="Tunnels">{data.tunnels.map((item) => <button key={item.id} role="tab" aria-selected={tunnel?.id === item.id} className={tunnel?.id === item.id ? 'active' : ''} onClick={() => { setSelectedTunnelId(item.id); setAccessFilter('all') }}><Status status={item.status} compact /><span>{item.name}</span><span className="tab-count">{visibleRoutes(item.routes).length}</span></button>)}</div><div className="layout-toggle" aria-label="View"><button aria-label="Canvas view" aria-pressed={layout === 'map'} className={layout === 'map' ? 'active' : ''} onClick={() => setLayout('map')}><LayoutGrid size={15} /><span>Canvas</span></button><button aria-label="List view" aria-pressed={layout === 'list'} className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')}><List size={16} /><span>List</span></button></div></div>
            <div className="route-toolbar"><div className="selected-tunnel-label"><TunnelMark size={18} /><strong>{tunnel?.name || 'Tunnels'}</strong><Status status={tunnel?.status || 'inactive'} /><span className="route-toolbar-divider" /><span>{routes.length} {routes.length === 1 ? 'route' : 'routes'}</span></div><div className="route-tools"><label className="search-field"><Search size={14} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a route…" aria-label="Find a route" /><kbd>⌘ K</kbd></label><label className="filter-select" title="Filter routes by Access application"><SlidersHorizontal size={14} /><select aria-label="Access filter" value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)}><option value="all">All routes</option><option value="access">With Access</option><option value="no-access">Without Access</option></select><ChevronDown size={12} /></label><button className="icon-button" aria-label="Tunnel details" onClick={() => setDialog({ kind: 'tunnel-detail' })} disabled={!tunnel}><MoreHorizontal size={18} /></button></div></div>
            {!tunnel ? <div><Empty title={tunnelLoadFailed ? 'Couldn’t load tunnels' : 'No cloudflared tunnels returned'}><p>{tunnelLoadFailed ? 'Tunnel discovery failed. The API response details below identify which requests failed.' : 'No cloudflared tunnels are visible to these credentials. Verify the account ID and Cloudflare Tunnel permissions. Cloudflare can return an empty list when access is restricted.'}</p><button className="button secondary" onClick={() => changeView('settings')}>Account settings</button></Empty>{data.tunnelDiscovery && <DiscoveryDetails discovery={data.tunnelDiscovery} onCopy={() => copy(JSON.stringify({ accountSuffix: data.accountId.slice(-6), ...data.tunnelDiscovery }, null, 2))} />}</div> : layout === 'map' && (!query && accessFilter === 'all' || routes.length) ? <TunnelMap key={tunnel.id} tunnel={tunnel} routes={routes} applications={data.applications} onSelectRoute={(route) => setDialog({ kind: 'route-detail', route })} onAddRoute={() => setDialog({ kind: 'route-form' })} /> : <RouteTable routes={routes} applications={data.applications} onSelect={(route) => setDialog({ kind: 'route-detail', route })} />}
            <div className="network-footer"><span><span className="small-square" />{tunnel?.remote ? 'Remotely managed' : 'Locally managed'}</span><span>{layout === 'map' ? 'Select a route to view details' : 'Published application routes'}<ArrowUpRight size={12} /></span></div>
          </section>
          <section className="connected-applications"><div className="section-heading"><div><ShieldCheck size={17} /><h2>Access applications</h2><span className="subtle-count">{data.applications.length}</span></div><button className="text-button" onClick={() => changeView('applications')}>Manage applications<ArrowRight size={14} /></button></div><ApplicationsTable applications={data.applications} policies={data.policies} onSelect={(application) => setDialog({ kind: 'application-detail', application })} compact /></section>
        </>}

        {view === 'applications' && <section className="data-panel"><div className="table-toolbar"><label className="search-field wide-search"><Search size={15} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an application…" aria-label="Find an application" /><kbd>⌘ K</kbd></label><span className="table-meta">{applications.length} applications<span className="tag">Self-hosted</span></span></div><ApplicationsTable applications={applications} policies={data.policies} onSelect={(application) => setDialog({ kind: 'application-detail', application })} onSort={() => setSortAscending(!sortAscending)} ascending={sortAscending} /></section>}

        {view === 'policies' && <section className="data-panel"><div className="table-toolbar"><label className="search-field wide-search"><Search size={15} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a policy…" aria-label="Find a policy" /><kbd>⌘ K</kbd></label><ExternalLink href="https://one.dash.cloudflare.com/">Manage in Cloudflare</ExternalLink></div><div className="table-scroll"><table><thead><tr><th>Policy</th><th>Action</th><th>Applications</th><th>Rules</th></tr></thead><tbody>{data.policies.filter((policy) => policy.name.toLowerCase().includes(query)).map((policy) => <tr key={policy.id}><td><span className="table-name"><span className="table-icon"><SlidersHorizontal size={16} /></span>{policy.name}</span></td><td><span className={`policy-badge ${policy.decision === 'allow' ? 'allow' : ''}`}>{policy.decision === 'non_identity' ? 'Service auth' : policy.decision}</span></td><td>{data.applications.filter((app) => app.policies.some((item) => item.id === policy.id)).length}</td><td className="muted">{policy.includeCount} include {policy.includeCount === 1 ? 'rule' : 'rules'}</td></tr>)}</tbody></table>{!data.policies.filter((policy) => policy.name.toLowerCase().includes(query)).length && <Empty title="No policies found"><p>Reusable policies are managed in Cloudflare.</p></Empty>}</div></section>}

        {view === 'settings' && <div className="settings-layout"><div>{connected && data.mode === 'live' && <section className="connected-card"><div><span className="settings-icon"><Cloud size={20} /></span><div><h2>{sessionExpired ? 'Connection unavailable' : 'Cloudflare connected'}</h2><p className="mono">{data.accountId}</p><span className="form-hint">{sessionExpired ? 'Reconnect below. Displayed account data is from your last sync.' : data.source === 'environment' ? 'Using credentials from environment variables.' : 'Using credentials saved on this dashboard.'}</span></div><span className={sessionExpired ? 'muted-dot' : 'live-dot'} /></div>{data.source === 'storage' && <button className="button secondary" onClick={disconnect} disabled={pending}>{pending ? <Spinner /> : <Unplug size={14} />}Disconnect account</button>}</section>}<ConnectionForm onConnect={connect} pending={pending} error={connectionError} /></div><aside className="settings-aside"><Cloud size={23} /><h3>Connection details</h3><p>Tunnels, self-hosted applications, existing policies, and DNS zones from your account.</p><div className="settings-aside-rule" /><span className="eyebrow">LOCAL SETUP</span><p>Prefer environment variables? Add your credentials to <code>.env</code> using <code>.env.example</code>, then restart the server.</p><p className="form-hint">Use an API token scoped to the account and zones you want to manage.</p></aside></div>}

        {data.fetchedAt && <footer className="page-footer">Updated {new Date(data.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</footer>}
      </main>
    </div>

    {toast && <div className="toast" role="status"><span><Check size={14} /></span>{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={13} /></button></div>}

    {dialog && <Modal wide={dialog.kind === 'service-form'} title={dialog.kind === 'service-form' ? unfinishedService ? 'Resume service' : 'New service' : dialog.kind === 'route-form' ? 'Add route' : dialog.kind === 'application-form' ? 'New application' : dialog.kind === 'route-detail' ? 'Route details' : dialog.kind === 'remove-route' ? 'Remove route?' : dialog.kind === 'remove-application' ? 'Remove application?' : dialog.kind === 'application-detail' ? dialog.application.name : 'Tunnel details'} onClose={closeDialog}>
      {dialog.kind === 'route-form' || dialog.kind === 'application-form' || dialog.kind === 'service-form' ? <ResourceForm key={dialog.kind} kind={dialog.kind === 'route-form' ? 'route' : dialog.kind === 'service-form' ? 'service' : 'application'} data={data} initialTunnelId={tunnel?.id} initialHostname={'hostname' in dialog ? dialog.hostname : undefined} initialPath={dialog.kind === 'application-form' ? dialog.path : undefined} initialService={dialog.kind === 'service-form' ? unfinishedService?.input : undefined} initialError={dialog.kind === 'service-form' ? unfinishedService?.error : undefined} onSubmit={saveResource} onCancel={closeDialog} pending={pending} /> : null}
      {dialog.kind === 'route-detail' && <RouteDetail route={dialog.route} application={findApplication(dialog.route, data.applications)} tunnel={tunnel} onRemove={() => setDialog({ kind: 'remove-route', route: dialog.route })} onCreateApplication={() => setDialog({ kind: 'application-form', hostname: dialog.route.hostname, path: dialog.route.path })} onApplication={(application) => setDialog({ kind: 'application-detail', application })} />}
      {dialog.kind === 'application-detail' && <><div className="detail-body"><div className="detail-resource"><span className="detail-resource-icon"><ShieldCheck size={24} /></span><div><strong>{dialog.application.name}</strong><span>Self-hosted application</span></div><span className="tag">Self-hosted</span></div><DetailRow label="Public hostname"><span className="mono">{dialog.application.domain}</span></DetailRow>{dialog.application.destinations.filter((destination) => destination !== dialog.application.domain).map((destination) => <DetailRow label="Destination" key={destination}><span className="mono">{destination}</span></DetailRow>)}<DetailRow label="Session duration">{dialog.application.sessionDuration}</DetailRow><div className="form-section-label">ATTACHED POLICIES</div><div className="detail-policies">{dialog.application.policies.length ? dialog.application.policies.map((policy) => <span key={policy.id}><ShieldCheck size={15} />{policy.name || data.policies.find((item) => item.id === policy.id)?.name || policy.id}</span>) : <span className="muted">No policies attached</span>}</div></div><footer className="modal-footer"><button className="button danger-ghost" onClick={() => setDialog({ kind: 'remove-application', application: dialog.application })}><Trash2 size={14} />Remove application</button><button className="button secondary" onClick={closeDialog}>Done</button></footer></>}
      {dialog.kind === 'tunnel-detail' && tunnel && <><div className="detail-body"><div className="detail-resource"><span className="detail-resource-icon"><TunnelMark size={26} /></span><div><strong>{tunnel.name}</strong><span>Cloudflare Tunnel</span></div><Status status={tunnel.status} /></div><DetailRow label="Tunnel ID"><span className="mono breakable">{tunnel.id}</span><button className="icon-button" aria-label="Copy tunnel ID" onClick={() => copy(tunnel.id)}><Copy size={14} /></button></DetailRow><DetailRow label="Configuration">{tunnel.remote ? 'Remotely managed' : 'Locally managed'}</DetailRow><DetailRow label="Connections">{tunnel.connections}</DetailRow><DetailRow label="Published routes">{visibleRoutes(tunnel.routes).length}</DetailRow><DetailRow label="Created">{tunnel.createdAt ? new Date(tunnel.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unavailable'}</DetailRow></div><footer className="modal-footer"><ExternalLink href="https://one.dash.cloudflare.com/">Open Cloudflare</ExternalLink><button className="button secondary" onClick={closeDialog}>Done</button></footer></>}
      {(dialog.kind === 'remove-route' || dialog.kind === 'remove-application') && <DeleteConfirmation pending={pending} onCancel={closeDialog} resource={dialog.kind === 'remove-route' ? `${dialog.route.hostname}${dialog.route.path || ''}` : dialog.application.name} description={dialog.kind === 'remove-route' ? 'Traffic will no longer reach this service through this route. The DNS record and Access application stay in place.' : 'This removes the Access application and its policy attachments. The tunnel route and DNS record stay in place.'} onConfirm={async () => {
        if (dialog.kind === 'remove-route' && tunnel && dialog.route.hostname) {
          const input = { tunnelId: tunnel.id, hostname: dialog.route.hostname, path: dialog.route.path || '', service: dialog.route.service }
          await mutate(() => api.removeRoute({ data: input }), (current) => ({ ...current, tunnels: current.tunnels.map((item) => item.id === tunnel.id ? { ...item, routes: removeIngressRule(item.routes, dialog.route) } : item) }), 'Route removed')
        } else if (dialog.kind === 'remove-application') {
          await mutate(() => api.removeApplication({ data: { id: dialog.application.id } }), (current) => ({ ...current, applications: current.applications.filter((app) => app.id !== dialog.application.id) }), 'Application removed')
          if (unfinishedService?.input.applicationId === dialog.application.id) setUnfinishedService(null)
        }
      }} />}
    </Modal>}
  </div>
}

function DiscoveryDetails({ discovery, onCopy }: { discovery: TunnelDiscovery; onCopy: () => void }) {
  return <details className="discovery-details"><summary>API response details</summary><div className="discovery-results">{discovery.requests.map((request) => <div key={request.endpoint}><code>{request.endpoint}</code><p>{request.error || `${request.count} returned${request.totalCount === null ? '' : ` · ${request.totalCount} reported total`}`}</p>{request.types.length > 0 && <p>{request.types.map((item) => `${item.count} ${item.type}`).join(' · ')}</p>}</div>)}<button className="button secondary small" onClick={onCopy}><Copy size={13} />Copy diagnostic</button></div></details>
}

function ApplicationsTable({ applications, policies, onSelect, onSort, ascending, compact }: { applications: AccessApplication[]; policies: DashboardData['policies']; onSelect: (application: AccessApplication) => void; onSort?: () => void; ascending?: boolean; compact?: boolean }) {
  return <div className={`table-scroll applications-table ${compact ? 'compact-table' : ''}`}><table><thead><tr><th>{onSort ? <button className="table-sort" onClick={onSort}>Application<ArrowDown size={12} style={{ transform: ascending ? 'rotate(180deg)' : undefined }} /></button> : 'Application'}</th><th>Public hostname</th><th>Access policies</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{applications.map((app) => <tr key={app.id}><td><button className="table-name table-link" onClick={() => onSelect(app)}><span className="table-icon"><ShieldCheck size={16} /></span>{app.name}</button></td><td><span className="hostname-cell mono">{app.domain}<button className="inline-icon" aria-label={`Details for ${app.domain}`} onClick={() => onSelect(app)}><ArrowUpRight size={12} /></button></span></td><td><div className="policy-tags">{app.policies.slice(0, 2).map((policy) => <span key={policy.id} className="policy-tag"><ShieldCheck size={11} />{policy.name || policies.find((item) => item.id === policy.id)?.name || 'Policy'}</span>)}{app.policies.length > 2 && <span className="policy-tag">+{app.policies.length - 2}</span>}{!app.policies.length && <span className="muted">No policies</span>}</div></td><td><button className="icon-button" aria-label={`Manage ${app.name}`} onClick={() => onSelect(app)}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table>{!applications.length && <Empty title="No applications found"><p>Create a self-hosted application to attach an Access policy.</p></Empty>}</div>
}

function RouteTable({ routes, applications, onSelect }: { routes: IngressRule[]; applications: AccessApplication[]; onSelect: (route: IngressRule) => void }) {
  return <div className="table-scroll route-table"><table><thead><tr><th>Hostname / path</th><th>Service</th><th>Access application</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{routes.map((route) => {
    const app = findApplication(route, applications)
    return <tr key={`${route.hostname}-${route.path}`}><td><button className="table-link mono" onClick={() => onSelect(route)}><Globe2 size={15} />{route.hostname}{route.path}</button></td><td className="mono muted">{route.service}</td><td>{app ? <span className="policy-tag"><ShieldCheck size={12} />{app.name}</span> : <span className="muted">None</span>}</td><td><button className="icon-button" aria-label={`Manage ${route.hostname}`} onClick={() => onSelect(route)}><MoreHorizontal size={17} /></button></td></tr>
  })}</tbody></table>{!routes.length && <Empty title="No matching routes"><p>Try another search or filter.</p></Empty>}</div>
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="detail-row"><span>{label}</span><div>{children}</div></div>
}

function RouteDetail({ route, application, tunnel, onRemove, onCreateApplication, onApplication }: { route: IngressRule; application?: AccessApplication; tunnel?: Tunnel; onRemove: () => void; onCreateApplication: () => void; onApplication: (application: AccessApplication) => void }) {
  return <><div className="detail-body"><div className="detail-resource"><span className="detail-resource-icon"><Globe2 size={24} /></span><div><strong className="breakable">{route.hostname}</strong><span>Published application</span></div></div><DetailRow label="Tunnel"><TunnelMark size={15} />{tunnel?.name}</DetailRow><DetailRow label="Path"><span className="mono">{route.path || 'All paths'}</span></DetailRow><DetailRow label="Service URL"><span className="mono breakable">{route.service}</span></DetailRow><div className="form-section-label">ZERO TRUST ACCESS</div>{application ? <button className="detail-access" onClick={() => onApplication(application)}><ShieldCheck size={19} /><span><strong>{application.name}</strong><small>{application.policies.length} {application.policies.length === 1 ? 'policy' : 'policies'} attached</small></span><ChevronRight size={15} /></button> : <div className="no-access"><Shield size={18} /><div><strong>No Access application</strong><p>Attach an application to control access.</p></div><button className="button secondary small" onClick={onCreateApplication}><Plus size={13} />Create</button></div>}</div><footer className="modal-footer"><button className="button danger-ghost" onClick={onRemove} disabled={!tunnel?.remote}><Trash2 size={14} />Remove route</button><button className="button secondary" onClick={() => { const url = `https://${route.hostname}${route.path || ''}`; window.open(url, '_blank', 'noopener,noreferrer') }} disabled={route.hostname?.includes('*')}><ArrowUpRight size={14} />Open hostname</button></footer></>
}

function DeleteConfirmation({ resource, description, pending, onCancel, onConfirm }: { resource: string; description: string; pending: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [error, setError] = useState('')
  return <><div className="delete-body"><span className="delete-icon"><Trash2 size={22} /></span><strong>{resource}</strong><p>{description}</p>{error && <p className="form-error" role="alert">{error}</p>}</div><footer className="modal-footer"><button className="button secondary" onClick={onCancel} disabled={pending}>Cancel</button><button className="button danger" disabled={pending} onClick={async () => { try { await onConfirm() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t remove. Try again.') } }}>{pending ? <Spinner /> : <Trash2 size={14} />}Remove</button></footer></>
}
