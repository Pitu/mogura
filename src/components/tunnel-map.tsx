import { useRef, useState, type PointerEvent } from 'react'
import { ArrowRight, Globe2, Hand, Maximize, Minus, Plus, ShieldCheck } from 'lucide-react'
import { findApplication } from '../lib/access'
import type { AccessApplication, IngressRule, Tunnel } from '../lib/types'
import { Empty, Status, TunnelMark } from './ui'

interface Props {
  tunnel: Tunnel
  routes: IngressRule[]
  applications: AccessApplication[]
  onSelectRoute: (route: IngressRule) => void
  onAddRoute: () => void
}

export function TunnelMap({ tunnel, routes, applications, onSelectRoute, onAddRoute }: Props) {
  const [zoom, setZoom] = useState(1)
  const [hovered, setHovered] = useState<number | null>(null)
  const [pan, setPan] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const height = Math.max(520, routes.length * 78 + 100)
  const nodeY = height / 2 - 82
  const startY = (height - routes.length * 78) / 2

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!pan || !scroller.current || (event.target as HTMLElement).closest('button')) return
    drag.current = { x: event.clientX, y: event.clientY, left: scroller.current.scrollLeft, top: scroller.current.scrollTop }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  if (!routes.length) return <div className="map-empty"><Empty title={tunnel.error ? 'Configuration unavailable' : tunnel.remote ? 'No published routes' : 'Locally managed tunnel'}><p>{tunnel.error || (tunnel.remote ? 'Add a hostname to connect a service.' : 'Routes are managed in this tunnel’s cloudflared configuration.')}</p>{tunnel.remote && !tunnel.error && <button className="button secondary" onClick={onAddRoute}><Plus size={15} />Add route</button>}</Empty></div>

  return <div className="canvas">
    <div className={`canvas-scroll ${pan ? 'panning' : ''}`} ref={scroller} onPointerDown={pointerDown} onPointerMove={(event) => {
      if (!drag.current || !scroller.current) return
      scroller.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x)
      scroller.current.scrollTop = drag.current.top - (event.clientY - drag.current.y)
    }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <div className="canvas-size" style={{ width: 960 * zoom, height: height * zoom }}>
        <div className="canvas-content" style={{ width: 960, height, transform: `scale(${zoom})` }}>
          <div className="canvas-label tunnel-label">TUNNEL</div><div className="canvas-label routes-label">PUBLISHED APPLICATIONS <span>{routes.length}</span></div>
          <svg className="connectors" width="960" height={height} aria-hidden="true">
            {routes.map((route, index) => {
              const end = startY + index * 78 + 31
              return <g key={`${route.hostname}-${route.path}`}><path d={`M 280 ${nodeY + 81} C 345 ${nodeY + 81}, 345 ${end}, 410 ${end}`} className={hovered === index ? 'connector active' : 'connector'} /><circle cx="280" cy={nodeY + 81} r="3" className="connector-port" /><circle cx="410" cy={end} r="3" className={hovered === index ? 'connector-port active' : 'connector-port'} /></g>
            })}
          </svg>
          <div className="tunnel-node" style={{ top: nodeY }}><div className="tunnel-node-top"><span className="node-icon"><TunnelMark size={25} /></span><Status status={tunnel.status} /></div><strong>{tunnel.name}</strong><div className="node-id mono">{tunnel.id.slice(0, 8)}…{tunnel.id.slice(-4)}</div><div className="tunnel-node-bottom"><i className={tunnel.connections ? 'connection-dot' : 'connection-dot muted-dot'} />{tunnel.connections} connections<span>cloudflared</span></div><span className="node-port" /></div>
          {routes.map((route, index) => {
            const app = findApplication(route, applications)
            return <button className={`route-node ${hovered === index ? 'hovered' : ''}`} style={{ top: startY + index * 78 }} key={`${route.hostname}-${route.path}`} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} onClick={() => onSelectRoute(route)}>
              <span className="route-globe"><Globe2 size={17} /></span><span className="route-node-text"><strong>{route.hostname}<span className="route-path">{route.path}</span></strong><span className="route-service mono"><ArrowRight size={12} />{route.service}</span></span><span className={`route-access ${app ? 'has-access' : ''}`} title={app ? `Access: ${app.name}` : 'No Access application'}>{app ? <ShieldCheck size={17} /> : <ArrowRight size={16} />}</span>
            </button>
          })}
        </div>
      </div>
    </div>
    <div className="canvas-legend"><span><ShieldCheck size={13} />Access application</span><span><i />No Access application</span></div>
    <div className="canvas-controls"><button className={`icon-button ${pan ? 'selected' : ''}`} aria-label="Pan canvas" aria-pressed={pan} onClick={() => setPan(!pan)}><Hand size={15} /></button><span className="control-divider" /><button className="icon-button" aria-label="Zoom out" disabled={zoom <= .6} onClick={() => setZoom(Math.max(.6, Math.round((zoom - .1) * 10) / 10))}><Minus size={15} /></button><span className="zoom-label">{Math.round(zoom * 100)}%</span><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 1.5} onClick={() => setZoom(Math.min(1.5, Math.round((zoom + .1) * 10) / 10))}><Plus size={15} /></button><span className="control-divider" /><button className="icon-button" aria-label="Fit canvas" onClick={() => { setZoom(Math.min(1, (scroller.current?.clientWidth || 960) / 960)); scroller.current?.scrollTo(0, 0) }}><Maximize size={14} /></button></div>
  </div>
}
