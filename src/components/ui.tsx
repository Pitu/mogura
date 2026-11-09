import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ArrowUpRight, Check, Copy, LoaderCircle, X } from 'lucide-react'
import type { Tunnel } from '../lib/types'

export function TunnelMark({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 20V11a7 7 0 0 1 14 0v9M9 20V11a3 3 0 0 1 6 0v9M3 20h18" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" /><path d="M12 17v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
}

export function Status({ status, compact = false }: { status: Tunnel['status']; compact?: boolean }) {
  const label = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down', inactive: 'Inactive' }[status]
  return <span className={`status status-${status}`}><i aria-hidden="true" />{compact ? <span className="sr-only">{label}</span> : label}</span>
}

export function Spinner() { return <LoaderCircle size={16} className="spin" aria-label="Loading" /> }

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><TunnelMark size={28} /><h3>{title}</h3>{children}</div>
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.showModal()
    return () => { if (previous instanceof HTMLElement) previous.focus() }
  }, [])
  return <dialog ref={ref} aria-labelledby={titleId} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal-inner"><header className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>{children}</div>
  </dialog>
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="external-link">{children}<ArrowUpRight size={14} /></a>
}

export function CopyButton({ value, copied, onCopy }: { value: string; copied: boolean; onCopy: (value: string) => void }) {
  return <button className="icon-button" aria-label="Copy tunnel ID" onClick={() => onCopy(value)}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
}
