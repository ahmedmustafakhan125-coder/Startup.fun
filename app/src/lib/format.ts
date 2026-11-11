const cf = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const cf2 = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })

export const usd = (n: number, digits = 0) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const usdCompact = (n: number) => (Math.abs(n) < 1000 ? usd(n, n % 1 === 0 ? 0 : 2) : '$' + (Math.abs(n) < 10_000 ? cf2 : cf).format(n))

export const num = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })

export const compact = (n: number) => (Math.abs(n) < 1000 ? num(n, 2) : cf.format(n))

export const price = (p: number) => {
  if (!isFinite(p) || p <= 0) return '$0'
  if (p >= 1) return '$' + p.toFixed(2)
  const digits = Math.min(10, Math.max(2, 3 - Math.floor(Math.log10(p))))
  return '$' + p.toFixed(digits)
}

export const pct = (x: number, digits = 1) => (x >= 0 ? '+' : '') + (x * 100).toFixed(digits) + '%'
export const pctPlain = (x: number, digits = 0) => (x * 100).toFixed(digits) + '%'

export const shortAddr = (a: string) => (a.length > 10 ? a.slice(0, 4) + '…' + a.slice(-4) : a)

const DAY = 86_400_000
export const dayMs = DAY
export const dateLabel = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const dateLong = (ts: number) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export const isoDay = (ts: number) => new Date(ts).toISOString().slice(0, 10)

export const ago = (ts: number) => {
  const s = Math.max(0, Date.now() - ts) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  const d = Math.floor(s / 86400)
  return d + (d === 1 ? ' day ago' : ' days ago')
}
export const daysBetween = (a: number, b: number) => Math.round((b - a) / DAY)
