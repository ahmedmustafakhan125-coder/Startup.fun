import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CHART } from '../config'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => setW(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function niceTicks(min: number, max: number, count = 3) {
  if (max - min <= 0) return [min]
  const step = (max - min) / count
  return Array.from({ length: count + 1 }, (_, i) => min + step * i)
}

const INK3 = '#6f7888'
const GRID = 'rgba(255,255,255,.07)'

function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), Math.max(70, w - 70))
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl px-3 py-2 text-sm whitespace-nowrap"
      style={{ left, top: Math.max(y - 10, 44), background: 'rgba(12,16,26,.96)', border: '1px solid rgba(255,255,255,.14)', boxShadow: '0 12px 30px -10px rgba(0,0,0,.9)' }}
    >
      {children}
    </div>
  )
}

export function AreaChart({
  data,
  labels,
  height = 260,
  format,
  color = CHART.series,
  name = 'Value',
}: {
  data: number[]
  labels?: (i: number) => string
  height?: number
  format: (n: number) => string
  color?: string
  name?: string
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')
  const padR = 62
  const padT = 14
  const padB = labels ? 26 : 10
  const iw = Math.max(10, w - padR)
  const ih = height - padT - padB
  const lo0 = Math.min(...data)
  const hi0 = Math.max(...data)
  const span = hi0 - lo0 || hi0 || 1
  const lo = lo0 - span * 0.12
  const top = hi0 + span * 0.12
  const X = (i: number) => (data.length <= 1 ? 0 : (i / (data.length - 1)) * iw)
  const Y = (v: number) => padT + (1 - (v - lo) / (top - lo)) * ih
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')
  const area = `${line}L${iw},${padT + ih}L0,${padT + ih}Z`
  const ticks = niceTicks(lo0, hi0, 3)
  const move = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    const x = clientX - rect.left
    setHi(Math.max(0, Math.min(data.length - 1, Math.round((x / iw) * (data.length - 1)))))
  }
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height, touchAction: 'pan-y' }} onPointerMove={e => move(e.clientX)} onPointerDown={e => move(e.clientX)} onPointerLeave={() => setHi(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`${name} over time, latest ${format(data[data.length - 1])}`}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.28" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={0} x2={iw} y1={Y(t)} y2={Y(t)} stroke={GRID} />
              <text x={w - 2} y={Y(t) + 4} textAnchor="end" fontSize="12" fill={INK3}>
                {format(t)}
              </text>
            </g>
          ))}
          <path d={area} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {labels &&
            [0, Math.floor((data.length - 1) / 2), data.length - 1].map((i, k) => (
              <text key={k} x={X(i)} y={height - 6} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} fontSize="12" fill={INK3}>
                {labels(i)}
              </text>
            ))}
          {hi !== null && (
            <g>
              <line x1={X(hi)} x2={X(hi)} y1={padT} y2={padT + ih} stroke="rgba(255,255,255,.28)" strokeDasharray="3 4" />
              <circle cx={X(hi)} cy={Y(data[hi])} r="5" fill={color} stroke="#0a0d14" strokeWidth="2" />
            </g>
          )}
        </svg>
      )}
      {hi !== null && w > 0 && (
        <Tip x={X(hi)} y={Y(data[hi])} w={w}>
          <div className="font-semibold text-ink">{format(data[hi])}</div>
          {labels && <div className="text-ink3">{labels(hi)}</div>}
        </Tip>
      )}
    </div>
  )
}

export function BarChart({
  data,
  height = 220,
  format,
  color = CHART.cat[0],
  name = 'Value',
}: {
  data: { label: string; value: number }[]
  height?: number
  format: (n: number) => string
  color?: string
  name?: string
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const padR = 56
  const padT = 12
  const padB = 26
  const iw = Math.max(10, w - padR)
  const ih = height - padT - padB
  const max = Math.max(...data.map(d => d.value), 1) * 1.08
  const slot = iw / data.length
  const bw = Math.max(2, Math.min(24, slot - 2))
  const Y = (v: number) => padT + (1 - v / max) * ih
  const ticks = niceTicks(0, max / 1.08, 3)
  const every = Math.ceil(data.length / (w < 480 ? 4 : 7))
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height, touchAction: 'pan-y' }} onPointerLeave={() => setHi(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`${name} by day`}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={0} x2={iw} y1={Y(t)} y2={Y(t)} stroke={GRID} />
              <text x={w - 2} y={Y(t) + 4} textAnchor="end" fontSize="12" fill={INK3}>
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = i * slot + (slot - bw) / 2
            const y = Y(d.value)
            const h = Math.max(1, padT + ih - y)
            const r = Math.min(4, bw / 2, h)
            return (
              <g key={i}>
                <path d={`M${x},${y + h}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y + h}Z`} fill={color} opacity={hi === null || hi === i ? 1 : 0.45} />
                <rect x={i * slot} y={padT} width={slot} height={ih} fill="transparent" onPointerEnter={() => setHi(i)} onPointerDown={() => setHi(i)} />
                {(i % every === 0 || i === data.length - 1) && (i === data.length - 1 || data.length - 1 - i >= every * 0.6) && (
                  <text x={i === 0 ? i * slot : i * slot + slot / 2} y={height - 6} textAnchor={i === data.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'} fontSize="12" fill={INK3}>
                    {d.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {hi !== null && w > 0 && (
        <Tip x={hi * slot + slot / 2} y={Y(data[hi].value)} w={w}>
          <div className="font-semibold text-ink">{format(data[hi].value)}</div>
          <div className="text-ink3">{data[hi].label}</div>
        </Tip>
      )}
    </div>
  )
}

export function Sparkline({ data, width = 96, height = 32, color = CHART.series }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return <svg width={width} height={height} aria-hidden="true" />
  const lo = Math.min(...data)
  const hi = Math.max(...data)
  const span = hi - lo || 1
  const d = data
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (data.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - ((v - lo) / span) * (height - 6)).toFixed(1)}`)
    .join('')
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// Part-to-whole bar with a legend that carries the values, so colour is never the only cue.
export function SplitBar({ segments, format, height = 14 }: { segments: { label: string; value: number; note?: string }[]; format: (n: number) => string; height?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  return (
    <div>
      <div className="flex w-full gap-[2px]" style={{ height }} role="img" aria-label={segments.map(s => `${s.label} ${format(s.value)}`).join(', ')}>
        {segments.map((s, i) => (
          <div key={s.label} title={`${s.label}: ${format(s.value)}`} style={{ width: `${(s.value / total) * 100}%`, background: CHART.cat[i % CHART.cat.length], borderRadius: 4, minWidth: s.value > 0 ? 4 : 0 }} />
        ))}
      </div>
      <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-start gap-2.5">
            <span className="mt-[7px] h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: CHART.cat[i % CHART.cat.length] }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-ink">{s.label}</span>
                <span className="font-semibold text-ink">{format(s.value)}</span>
              </span>
              {s.note && <span className="block text-sm text-ink3">{s.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
