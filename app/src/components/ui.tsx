import { useEffect, type CSSProperties, type ReactNode } from 'react'
import type { Check, Heartbeat, Phase, Startup } from '../store/types'

const paths: Record<string, ReactNode> = {
  pulse: <path d="M2 12h4l2.5-6 4 12 2.5-6H22" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  shield: <path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" />,
  globe: (<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.8 2.4 2.8 14.6 0 17M12 3.5c-2.8 2.4-2.8 14.6 0 17" /></>),
  code: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13" />,
  at: (<><circle cx="12" cy="12" r="3.5" /><path d="M15.5 8.5v5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8" /></>),
  user: (<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5" /></>),
  wallet: (<><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="8" width="16" height="11" rx="2.5" /><path d="M16 13.5h1" /></>),
  home: <path d="M4 11 12 4.5 20 11v8.5h-5.5V14h-5v5.5H4V11Z" />,
  grid: (<><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>),
  plus: <path d="M12 5v14M5 12h14" />,
  chart: <path d="M4 19.5h16M7 16v-4M12 16V7M17 16v-6.5" />,
  briefcase: (<><rect x="3.5" y="7.5" width="17" height="12" rx="2.5" /><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 13h17" /></>),
  gauge: (<><path d="M4.5 17a8.5 8.5 0 1 1 15 0" /><path d="m12 13 3.5-4" /></>),
  lock: (<><rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>),
  copy: (<><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M5.5 15.5h-1v-10a1 1 0 0 1 1-1h10v1" /></>),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>),
  right: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  alert: (<><path d="M12 4 3 19.5h18L12 4Z" /><path d="M12 10v4.5M12 17.2v.1" /></>),
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  flame: <path d="M12 3.5c.5 3.5 4.5 5 4.5 9.5a4.5 4.5 0 0 1-9 0c0-1.8.8-2.8 1.7-3.8.3 1.3 1 2 1.8 2.3-.4-3 .2-5.7 1-8Z" />,
  vault: (<><rect x="4" y="5" width="16" height="14" rx="3" /><circle cx="12" cy="12" r="3" /><path d="M12 9v1M12 14v1M9 12h1M14 12h1" /></>),
  external: <path d="M14 5h5v5M19 5l-8 8M11 6H6.5A1.5 1.5 0 0 0 5 7.5v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.5V13" />,
  calendar: (<><rect x="4" y="5.5" width="16" height="14" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>),
}

export function Icon({ name, size = 18, className, style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flex: 'none', ...style }} aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Panel({ children, className, pad = true, style }: { children: ReactNode; className?: string; pad?: boolean; style?: CSSProperties }) {
  return (
    <section className={cx('glass', pad && 'p-5 sm:p-7', className)} style={style}>
      {children}
    </section>
  )
}

export function HeartbeatBadge({ hb, redDays, compact }: { hb: Heartbeat; redDays?: number; compact?: boolean }) {
  return hb === 'green' ? (
    <span className="badge badge-green">
      <span className="beat-dot" data-live="true" />
      {compact ? 'Alive' : 'Heartbeat passing'}
    </span>
  ) : (
    <span className="badge badge-red">
      <Icon name="alert" size={14} />
      {compact ? `Silent ${redDays ?? 0}d` : `Silent for ${redDays ?? 0} days`}
    </span>
  )
}

export function StatusBadge({ s, compact }: { s: Pick<Startup, 'phase' | 'heartbeat' | 'redDays'>; compact?: boolean }) {
  if (s.phase === 'raising')
    return (
      <span className="badge badge-blue">
        <Icon name="vault" size={14} />
        Raising
      </span>
    )
  if (s.phase === 'wound_down')
    return (
      <span className="badge badge-mute">
        <Icon name="refresh" size={14} />
        {compact ? 'Refunding' : 'Wound down, refunding'}
      </span>
    )
  return <HeartbeatBadge hb={s.heartbeat} redDays={s.redDays} compact={compact} />
}

export const phaseWord = (p: Phase) => (p === 'raising' ? 'Raising' : p === 'live' ? 'Trading' : 'Wound down')

export function CheckMark({ status, size = 22 }: { status: Check['status']; size?: number }) {
  const map = {
    passed: { bg: 'rgba(212,255,36,.14)', bd: 'rgba(212,255,36,.5)', fg: '#d4ff24', icon: 'check' },
    pending: { bg: 'rgba(255,184,77,.12)', bd: 'rgba(255,184,77,.45)', fg: '#ffb84d', icon: 'clock' },
    failed: { bg: 'rgba(255,107,94,.12)', bd: 'rgba(255,107,94,.5)', fg: '#ff6b5e', icon: 'x' },
  }[status]
  return (
    <span className="grid place-items-center rounded-full" style={{ width: size, height: size, background: map.bg, border: `1px solid ${map.bd}`, color: map.fg, flex: 'none' }} title={status}>
      <Icon name={map.icon} size={size * 0.6} />
    </span>
  )
}

export function Progress({ value, tone = 'lime', height = 8, marker }: { value: number; tone?: 'lime' | 'blue' | 'red' | 'mute'; height?: number; marker?: number }) {
  const color = { lime: '#d4ff24', blue: '#6ea2ff', red: '#ff6b5e', mute: '#6f7888' }[tone]
  return (
    <div className="relative w-full rounded-full" style={{ height, background: 'rgba(255,255,255,.07)' }} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color, transition: 'width .6s cubic-bezier(.2,.7,.2,1)' }} />
      {marker !== undefined && <div className="absolute top-[-3px] bottom-[-3px] w-[2px] rounded bg-white/50" style={{ left: `${marker * 100}%` }} />}
    </div>
  )
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-sm text-ink3">{label}</div>
      <div className="mt-1 font-display text-[26px] leading-none font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1.5 text-sm text-ink2">{sub}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] grid place-items-end sm:place-items-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} style={{ backdropFilter: 'blur(6px)' }} />
      <div className={cx('glass toast-in relative w-full p-6 sm:p-7 max-h-[88vh] overflow-y-auto', wide ? 'sm:max-w-[720px]' : 'sm:max-w-[440px]')} style={{ background: 'linear-gradient(180deg, rgba(22,27,40,.94), rgba(10,13,20,.96))' }}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <h2 className="text-[22px]">{title}</h2>
          <button className="btn btn-glass btn-sm !px-0 w-9" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="glass-flat px-6 py-10 text-center">
      <div className="font-display text-xl font-semibold">{title}</div>
      <p className="mx-auto mt-2 max-w-[46ch] text-ink2">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}

export function PageHead({ title, lead, right }: { title: string; lead?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[34px] sm:text-[44px]" style={{ fontStretch: '88%' }}>{title}</h1>
        {lead && <p className="mt-2 max-w-[62ch] text-ink2">{lead}</p>}
      </div>
      {right}
    </div>
  )
}
