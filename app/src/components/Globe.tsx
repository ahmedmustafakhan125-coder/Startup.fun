import { geoDistance, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import { useEffect, useMemo, useRef, useState } from 'react'
import { feature, mesh } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry, MultiLineString } from 'geojson'
import world from 'world-atlas/countries-110m.json'
import { countryOf } from '../data/countries'
import type { Startup } from '../store/types'
import { cx } from './ui'

// Map data is parsed once for the whole app.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const topo = world as any
const countries = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>
const borders = mesh(topo, topo.objects.countries, (a: unknown, b: unknown) => a !== b) as unknown as MultiLineString
const graticule = geoGraticule10()
const SPHERE = { type: 'Sphere' } as GeoPermissibleObjects

export interface CountryGroup {
  name: string
  code: string
  id: string
  lat: number
  lng: number
  startups: Startup[]
  alive: boolean // at least one startup that has not wound down
}

export function groupByCountry(startups: Startup[]): CountryGroup[] {
  const map = new Map<string, CountryGroup>()
  for (const s of startups) {
    const c = countryOf(s.country)
    if (!c) continue
    const g = map.get(c.name) ?? { ...c, startups: [], alive: false }
    g.startups.push(s)
    if (s.phase !== 'wound_down') g.alive = true
    map.set(c.name, g)
  }
  return [...map.values()].sort((a, b) => b.startups.length - a.startups.length || a.name.localeCompare(b.name))
}

const TILT = 18 // degrees the globe leans towards the viewer
const clampLat = (v: number) => Math.max(-42, Math.min(42, v))
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
const ease = (t: number) => 1 - Math.pow(1 - t, 3)

export function Globe({ groups, focus, onSelect }: { groups: CountryGroup[]; focus: string | null; onSelect: (name: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const markerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [size, setSize] = useState(300)
  const [hover, setHover] = useState<string | null>(null)
  // rotation lives in a ref so the animation loop never re-renders React
  const rot = useRef<[number, number]>([-50, -TILT])
  const anim = useRef<{ from: [number, number]; to: [number, number]; start: number; dur: number } | null>(null)
  const drag = useRef<{ x: number; y: number; r: [number, number]; moved: boolean } | null>(null)
  const pausedUntil = useRef(0)
  const hovering = useRef(false)
  const visible = useRef(true)
  const groupsRef = useRef(groups)
  const focusRef = useRef(focus)
  groupsRef.current = groups
  focusRef.current = focus

  const highlight = useMemo(() => {
    const live = new Set(groups.filter(g => g.alive).map(g => g.id))
    const dead = new Set(groups.filter(g => !g.alive).map(g => g.id))
    return {
      live: countries.features.filter(f => live.has(String(f.id))),
      dead: countries.features.filter(f => dead.has(String(f.id))),
    }
  }, [groups])
  const hlRef = useRef(highlight)
  hlRef.current = highlight

  // size follows the container
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const set = () => setSize(Math.max(260, Math.min(el.clientWidth, 560)))
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // fly to the focused country
  useEffect(() => {
    if (!focus) return
    const g = groups.find(x => x.name === focus)
    if (!g) return
    const [l0, p0] = rot.current
    const target: [number, number] = [l0 + wrap(-g.lng - l0), -clampLat(g.lat)]
    anim.current = { from: [l0, p0], to: target, start: performance.now(), dur: 1100 }
    pausedUntil.current = performance.now() + 4500
    // only fly when focus changes, not when a startup's numbers change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  // the render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = size + 'px'
    canvas.style.height = size + 'px'
    const r = size * 0.42
    const c = size / 2
    const proj = geoOrthographic().scale(r).translate([c, c]).clipAngle(90).precision(0.6)
    const path = geoPath(proj, ctx)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let last = performance.now()

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(64, now - last)
      last = now
      if (!visible.current || document.hidden) return

      const a = anim.current
      if (a) {
        const t = Math.min(1, (now - a.start) / (reduce ? 1 : a.dur))
        const k = ease(t)
        rot.current = [a.from[0] + (a.to[0] - a.from[0]) * k, a.from[1] + (a.to[1] - a.from[1]) * k]
        if (t >= 1) anim.current = null
      } else if (!drag.current && !hovering.current && now > pausedUntil.current && !reduce) {
        rot.current = [rot.current[0] + dt * 0.006, rot.current[1] + (-TILT - rot.current[1]) * 0.01]
      }
      const [lam, phi] = rot.current
      proj.rotate([lam, phi, 0])

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)

      // atmosphere
      const halo = ctx.createRadialGradient(c, c, r * 0.92, c, c, c)
      halo.addColorStop(0, 'rgba(70,130,255,0.42)')
      halo.addColorStop(0.4, 'rgba(21,88,201,0.16)')
      halo.addColorStop(1, 'rgba(21,88,201,0)')
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, size, size)

      // ocean, lit from the upper left
      const sea = ctx.createRadialGradient(c - r * 0.45, c - r * 0.5, r * 0.1, c, c, r * 1.05)
      sea.addColorStop(0, '#163a86')
      sea.addColorStop(0.55, '#0a1d4d')
      sea.addColorStop(1, '#040a1f')
      ctx.beginPath()
      path(SPHERE)
      ctx.fillStyle = sea
      ctx.fill()

      // grid
      ctx.beginPath()
      path(graticule)
      ctx.strokeStyle = 'rgba(110,162,255,0.09)'
      ctx.lineWidth = 0.6
      ctx.stroke()

      // land
      ctx.beginPath()
      path(countries)
      ctx.fillStyle = 'rgba(120,165,255,0.22)'
      ctx.fill()
      ctx.beginPath()
      path(borders)
      ctx.strokeStyle = 'rgba(160,195,255,0.28)'
      ctx.lineWidth = 0.5
      ctx.stroke()

      // countries with listed startups
      const hl = hlRef.current
      if (hl.dead.length) {
        ctx.beginPath()
        hl.dead.forEach(f => path(f as Feature))
        ctx.fillStyle = 'rgba(169,177,191,0.3)'
        ctx.fill()
      }
      if (hl.live.length) {
        ctx.beginPath()
        hl.live.forEach(f => path(f as Feature))
        ctx.fillStyle = 'rgba(212,255,36,0.34)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(212,255,36,0.85)'
        ctx.lineWidth = 0.9
        ctx.stroke()
      }

      // glassy rim and a soft highlight, so it reads as a polished sphere
      const shine = ctx.createRadialGradient(c - r * 0.5, c - r * 0.55, 0, c - r * 0.5, c - r * 0.55, r * 0.9)
      shine.addColorStop(0, 'rgba(255,255,255,0.13)')
      shine.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.beginPath()
      path(SPHERE)
      ctx.fillStyle = shine
      ctx.fill()
      const shade = ctx.createRadialGradient(c + r * 0.35, c + r * 0.4, r * 0.2, c, c, r * 1.02)
      shade.addColorStop(0, 'rgba(1,2,7,0)')
      shade.addColorStop(1, 'rgba(1,2,7,0.55)')
      ctx.fillStyle = shade
      ctx.fill()
      ctx.lineWidth = 1.2
      ctx.strokeStyle = 'rgba(150,190,255,0.35)'
      ctx.stroke()

      // markers are HTML buttons placed over the canvas
      const center: [number, number] = [-lam, -phi]
      for (const g of groupsRef.current) {
        const el = markerRefs.current[g.name]
        if (!el) continue
        const d = geoDistance([g.lng, g.lat], center)
        const p = proj([g.lng, g.lat])
        const front = d < Math.PI / 2 - 0.08
        if (!p || !front) {
          el.style.opacity = '0'
          el.style.pointerEvents = 'none'
          el.tabIndex = -1
          continue
        }
        const fade = Math.min(1, (Math.PI / 2 - d) / 0.35)
        el.style.opacity = String(fade)
        el.style.pointerEvents = 'auto'
        el.tabIndex = 0
        el.style.transform = `translate(${p[0]}px, ${p[1]}px)`
        // keep the label on the side with more room
        const side = p[0] > size * 0.62 ? 'left' : 'right'
        if (el.dataset.side !== side) el.dataset.side = side
      }
    }
    raf = requestAnimationFrame(frame)

    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => (visible.current = e.isIntersecting)) : null
    io?.observe(canvas)
    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
    }
  }, [size])

  // drag to spin
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { x: e.clientX, y: e.clientY, r: [...rot.current] as [number, number], moved: false }
    anim.current = null
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const k = 0.32 * (300 / size)
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    rot.current = [d.r[0] + dx * k, Math.max(-70, Math.min(70, d.r[1] - dy * k))]
  }
  const onUp = () => {
    drag.current = null
    pausedUntil.current = performance.now() + 2500
  }

  return (
    <div ref={wrapRef} className="w-full min-w-0" style={{ overflowX: 'clip' }}>
      <div
        className="relative mx-auto select-none"
        style={{ width: size, height: size, touchAction: 'pan-y', cursor: drag.current ? 'grabbing' : 'grab' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerEnter={() => (hovering.current = true)}
        onPointerLeave={() => {
          hovering.current = false
          setHover(null)
        }}
      >
        <canvas ref={canvasRef} aria-hidden="true" className="block" />
        {groups.map(g => {
          const on = focus === g.name || hover === g.name
          return (
            <button
              key={g.name}
              ref={el => {
                markerRefs.current[g.name] = el
              }}
              className="globe-marker"
              data-on={on}
              data-dead={!g.alive}
              style={{ opacity: 0 }}
              aria-label={`${g.name}: ${g.startups.map(s => s.name).join(', ')}`}
              onPointerEnter={() => setHover(g.name)}
              onPointerLeave={() => setHover(h => (h === g.name ? null : h))}
              onFocus={() => setHover(g.name)}
              onBlur={() => setHover(h => (h === g.name ? null : h))}
              onClick={() => onSelect(g.name)}
            >
              <span className="globe-pin">{g.startups.length > 1 && <span className="globe-count">{g.startups.length}</span>}</span>
              <span className={cx('globe-label', on && 'globe-label-on')}>
                <span className="font-semibold text-ink">{g.name}</span>
                <span className="text-ink2">{g.startups.map(s => s.ticker).join(', ')}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
