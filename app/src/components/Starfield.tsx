import { useEffect, useRef } from 'react'

// Two layers of stars drawn once onto canvases, then shifted a little on scroll for depth.
// Nothing redraws per frame, so the glass panels above stay cheap to blur.

const EXTRA = 420 // spare height so parallax never runs out of stars

function rand(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const tints = ['255,255,255', '255,255,255', '255,255,255', '207,224,255', '170,200,255', '255,236,214']

function paint(canvas: HTMLCanvasElement, w: number, h: number, layer: 'far' | 'near') {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)
  const r = rand(layer === 'far' ? 7 : 19)
  const area = w * h
  const count = Math.round(layer === 'far' ? area / 2300 : area / 16000)
  for (let i = 0; i < count; i++) {
    const x = r() * w
    const y = r() * h
    const tint = tints[Math.floor(r() * tints.length)]
    if (layer === 'far') {
      const size = 0.25 + r() * r() * 0.75
      ctx.fillStyle = `rgba(${tint},${0.18 + r() * 0.5})`
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const size = 0.6 + r() * r() * 1.1
      const alpha = 0.45 + r() * 0.5
      const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 5)
      glow.addColorStop(0, `rgba(${tint},${alpha * 0.35})`)
      glow.addColorStop(1, `rgba(${tint},0)`)
      ctx.fillStyle = glow
      ctx.fillRect(x - size * 5, y - size * 5, size * 10, size * 10)
      ctx.fillStyle = `rgba(${tint},${alpha})`
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
      // a thin cross on the brightest few
      if (size > 1.45 && r() < 0.5) {
        ctx.strokeStyle = `rgba(${tint},${alpha * 0.35})`
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(x - size * 6, y)
        ctx.lineTo(x + size * 6, y)
        ctx.moveTo(x, y - size * 6)
        ctx.lineTo(x, y + size * 6)
        ctx.stroke()
      }
    }
  }
}

// A handful of stars that twinkle with CSS, placed once.
const twinkles = (() => {
  const r = rand(311)
  return Array.from({ length: 16 }, () => ({
    left: r() * 100,
    top: r() * 100,
    size: 1.4 + r() * 1.4,
    delay: r() * 6,
    dur: 3.5 + r() * 4,
  }))
})()

export function Starfield() {
  const far = useRef<HTMLCanvasElement>(null)
  const near = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let w = 0
    const draw = () => {
      const nw = window.innerWidth
      // Mobile browsers resize the height as the address bar moves; only redraw on width changes.
      if (nw === w && far.current?.width) return
      w = nw
      const h = Math.max(window.innerHeight, window.screen?.height || 0) + EXTRA
      if (far.current) paint(far.current, w, h, 'far')
      if (near.current) paint(near.current, w, h, 'near')
    }
    draw()
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const y = window.scrollY
        if (far.current) far.current.style.transform = `translate3d(0,${-Math.min(EXTRA, y * 0.025)}px,0)`
        if (near.current) near.current.style.transform = `translate3d(0,${-Math.min(EXTRA, y * 0.06)}px,0)`
      })
    }
    let t: ReturnType<typeof setTimeout>
    const onResize = () => {
      clearTimeout(t)
      t = setTimeout(draw, 150)
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!reduce) window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [])

  return (
    <div className="backdrop" aria-hidden="true">
      <div className="nebula" />
      <canvas ref={far} className="stars" />
      <canvas ref={near} className="stars" />
      {twinkles.map((s, i) => (
        <span
          key={i}
          className="twinkle"
          style={{ left: s.left + '%', top: s.top + '%', width: s.size, height: s.size, animationDelay: s.delay + 's', animationDuration: s.dur + 's' }}
        />
      ))}
    </div>
  )
}
