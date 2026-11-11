import { DEMO_ADDRESS, FEE, GRADUATION_FEE, SUPPLY, TREASURY_SHARE } from '../config'
import { dayMs, isoDay } from '../lib/format'
import type { Application, Check, Checks, DayStat, Holding, Startup, Trade } from '../store/types'

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const passed = (detail: string, hoursAgo = 3): Check => ({ status: 'passed', detail, checkedAt: Date.now() - hoursAgo * 3_600_000 })
const pending = (detail: string): Check => ({ status: 'pending', detail, checkedAt: null })
const failed = (detail: string, hoursAgo = 20): Check => ({ status: 'failed', detail, checkedAt: Date.now() - hoursAgo * 3_600_000 })

export const allPassed = (domain: string, gh: string, social: string, hoursAgo = 3): Checks => ({
  kyc: passed('Identity confirmed for every listed founder', hoursAgo + 400),
  domain: passed(`DNS record found on ${domain}, site responds`, hoursAgo),
  github: passed(`${gh} is owned by the founder, commits this week`, hoursAgo),
  socials: passed(`${social} is controlled by the founder`, hoursAgo),
  founder: passed('Founder details match the public records provided', hoursAgo + 400),
})

interface LiveSpec {
  id: string
  name: string
  ticker: string
  tagline: string
  about: string
  category: string
  country: string
  founders: { name: string; role: string }[]
  raised: number
  mult: number // current price / sale price
  monthsLive: number
  monthlyBudget: number
  feeCap: number
  volumeTotal: number
  volume24h: number
  day: number // 24h move
  hb?: 'green' | 'red'
  redDays?: number
  mine?: boolean
  seed: number
}

function history(sale: number, mult: number, seed: number, n = 64) {
  const r = mulberry(seed)
  const out: number[] = []
  let walk = 0
  const walks: number[] = []
  for (let i = 0; i < n; i++) {
    walk += (r() - 0.5) * 0.16
    walks.push(walk)
  }
  const end = walks[n - 1]
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const drift = Math.log(mult) * t
    const noise = walks[i] - end * t // pinned at both ends
    out.push(sale * Math.exp(drift + noise))
  }
  return out
}

function live(spec: LiveSpec): Startup {
  const salePrice = spec.raised / SUPPLY.sale
  const net = spec.raised * (1 - GRADUATION_FEE)
  const pool0 = net * (1 - TREASURY_SHARE)
  const tokens0 = pool0 / salePrice
  const root = Math.sqrt(spec.mult)
  const poolUsdc = pool0 * root
  const poolTokens = tokens0 / root
  const released = Math.min(net * TREASURY_SHARE, spec.monthsLive * spec.monthlyBudget)
  const feesIn = spec.volumeTotal * FEE.startup
  const feesClaimed = Math.min(feesIn * 0.7, spec.monthsLive * spec.feeCap)
  const dom = spec.name.toLowerCase() + '.io'
  const hb = spec.hb ?? 'green'
  const redDays = spec.redDays ?? 0
  const hist = history(salePrice, spec.mult, spec.seed)
  const now = poolUsdc / poolTokens
  hist[hist.length - 1] = now
  const beats = Array.from({ length: 14 }, (_, i) => (hb === 'red' && i >= 14 - Math.ceil(redDays / 2) ? 0 : 1))
  const checks = allPassed(dom, 'github.com/' + spec.name.toLowerCase(), '@' + spec.name.toLowerCase())
  if (hb === 'red') {
    checks.domain = failed(`${dom} has not responded for ${redDays} days`)
    checks.github = failed('No commits or releases in the last 30 days')
  }
  return {
    id: spec.id,
    name: spec.name,
    ticker: spec.ticker,
    tagline: spec.tagline,
    about: spec.about,
    category: spec.category,
    country: spec.country,
    website: dom,
    github: 'github.com/' + spec.name.toLowerCase(),
    social: '@' + spec.name.toLowerCase(),
    founders: spec.founders,
    mine: !!spec.mine,
    listedAt: Date.now() - (spec.monthsLive * 30 + 9) * dayMs,
    phase: 'live',
    heartbeat: hb,
    redDays,
    lastBeat: Date.now() - (hb === 'red' ? redDays * dayMs : 2 * 3_600_000),
    beats,
    checks,
    raiseTarget: spec.raised,
    raised: spec.raised,
    salePrice,
    backers: Math.round(spec.raised / 310),
    poolUsdc,
    poolTokens,
    circulating: SUPPLY.sale + (tokens0 - poolTokens),
    treasury: net * TREASURY_SHARE - released,
    treasuryReleased: released,
    monthlyBudget: spec.monthlyBudget,
    treasuryClaimedThisMonth: spec.mine ? 0 : spec.monthlyBudget,
    feeVault: feesIn - feesClaimed,
    feeCap: spec.feeCap,
    feesClaimedThisMonth: 0,
    feesClaimedTotal: feesClaimed,
    holderReserve: spec.volumeTotal * FEE.reserve,
    vestMonths: spec.monthsLive,
    founderClaimed: 0,
    founderBurned: false,
    volume24h: spec.volume24h,
    volumeTotal: spec.volumeTotal,
    history: hist,
    openPrice24h: now / (1 + spec.day),
    refundPool: 0,
    refundPerToken: 0,
  }
}

function raising(o: {
  id: string
  name: string
  ticker: string
  tagline: string
  about: string
  category: string
  country: string
  founders: { name: string; role: string }[]
  target: number
  raised: number
  monthlyBudget: number
  feeCap: number
  daysAgo: number
}): Startup {
  const salePrice = o.target / SUPPLY.sale
  const dom = o.name.toLowerCase() + '.io'
  return {
    id: o.id,
    name: o.name,
    ticker: o.ticker,
    tagline: o.tagline,
    about: o.about,
    category: o.category,
    country: o.country,
    website: dom,
    github: 'github.com/' + o.name.toLowerCase(),
    social: '@' + o.name.toLowerCase(),
    founders: o.founders,
    mine: false,
    listedAt: Date.now() - o.daysAgo * dayMs,
    phase: 'raising',
    heartbeat: 'green',
    redDays: 0,
    lastBeat: Date.now() - 5 * 3_600_000,
    beats: Array(14).fill(1),
    checks: allPassed(dom, 'github.com/' + o.name.toLowerCase(), '@' + o.name.toLowerCase(), 5),
    raiseTarget: o.target,
    raised: o.raised,
    salePrice,
    backers: Math.round(o.raised / 260),
    poolUsdc: 0,
    poolTokens: 0,
    circulating: o.raised / salePrice,
    treasury: 0,
    treasuryReleased: 0,
    monthlyBudget: o.monthlyBudget,
    treasuryClaimedThisMonth: 0,
    feeVault: 0,
    feeCap: o.feeCap,
    feesClaimedThisMonth: 0,
    feesClaimedTotal: 0,
    holderReserve: 0,
    vestMonths: 0,
    founderClaimed: 0,
    founderBurned: false,
    volume24h: 0,
    volumeTotal: 0,
    history: [salePrice, salePrice],
    openPrice24h: salePrice,
    refundPool: 0,
    refundPerToken: 0,
  }
}

export function seedStartups(): Startup[] {
  const list: Startup[] = [
    live({
      id: 'northpane', country: 'United States', name: 'Northpane', ticker: 'NRTH', category: 'Developer tools', seed: 11,
      tagline: 'Review 3D CAD files in the browser, with comments pinned to the part',
      about: 'Hardware teams lose days mailing screenshots of models back and forth. Northpane opens STEP and Parasolid files in a browser tab, lets reviewers pin comments to faces and edges, and syncs the thread back to the engineer’s CAD tool.',
      founders: [{ name: 'Ilse Varga', role: 'CEO, ex mechanical engineer' }, { name: 'Tomás Reyna', role: 'CTO' }],
      raised: 240_000, mult: 3.4, monthsLive: 7, monthlyBudget: 14_000, feeCap: 2_500, volumeTotal: 2_900_000, volume24h: 61_400, day: 0.064,
    }),
    live({
      id: 'tallybird', country: 'Pakistan', name: 'Tallybird', ticker: 'TALY', category: 'Fintech', seed: 23, mine: true,
      tagline: 'Bookkeeping on autopilot for freelancers who invoice in three currencies',
      about: 'Tallybird reads bank feeds and invoices, matches them, and keeps a ledger a tax accountant can sign off. Built for freelancers paid in more than one currency, where spreadsheet bookkeeping falls apart first.',
      founders: [{ name: 'You (demo founder)', role: 'Founder' }, { name: 'Amara Osei', role: 'Head of product' }],
      raised: 120_000, mult: 1.9, monthsLive: 3, monthlyBudget: 9_000, feeCap: 1_500, volumeTotal: 860_000, volume24h: 22_750, day: 0.021,
    }),
    live({
      id: 'lumenroute', country: 'Saudi Arabia', name: 'Lumenroute', ticker: 'LUMN', category: 'Logistics', seed: 37,
      tagline: 'Route planning for delivery fleets of five to fifty vans',
      about: 'Small fleets plan routes on paper or in consumer map apps. Lumenroute takes the day’s orders, vehicle sizes and driver hours and returns routes that finish on time, then re-plans when a van breaks down.',
      founders: [{ name: 'Faisal Al-Harbi', role: 'CEO' }, { name: 'Sanne de Groot', role: 'Operations research lead' }],
      raised: 180_000, mult: 1.35, monthsLive: 5, monthlyBudget: 12_000, feeCap: 2_000, volumeTotal: 1_240_000, volume24h: 18_900, day: -0.034,
    }),
    live({
      id: 'quillstack', country: 'Germany', name: 'Quillstack', ticker: 'QUIL', category: 'Developer tools', seed: 51,
      tagline: 'Open-source docs engine that tests every code sample on each release',
      about: 'API docs rot because nobody runs the examples. Quillstack executes every snippet in CI against the current release and blocks the publish when one fails. The engine is open source; the hosted runner is the business.',
      founders: [{ name: 'Mei-Lin Okafor', role: 'Founder and maintainer' }],
      raised: 90_000, mult: 0.82, monthsLive: 4, monthlyBudget: 6_000, feeCap: 1_000, volumeTotal: 410_000, volume24h: 6_300, day: 0.009,
    }),
    live({
      id: 'fernwake', country: 'Pakistan', name: 'Fernwake', ticker: 'FERN', category: 'Climate', seed: 67, hb: 'red', redDays: 21,
      tagline: 'Soil moisture sensors priced for farms under twenty hectares',
      about: 'A solar probe and a phone app that tell a smallholder in Punjab when to irrigate. Fernwake sold a first batch of 400 probes and was building the second hardware revision.',
      founders: [{ name: 'Ayesha Siddiqui', role: 'CEO' }, { name: 'Bilal Qureshi', role: 'Hardware lead' }],
      raised: 150_000, mult: 0.46, monthsLive: 6, monthlyBudget: 10_000, feeCap: 1_500, volumeTotal: 720_000, volume24h: 31_200, day: -0.118,
    }),
    raising({
      id: 'mossbyte', country: 'United Kingdom', name: 'Mossbyte', ticker: 'MOSS', category: 'AI',
      tagline: 'A maths tutor that shows its working and checks yours, line by line',
      about: 'Mossbyte reads a photo of a student’s handwritten solution, finds the first line that goes wrong and explains only that step. Piloting with four secondary schools.',
      founders: [{ name: 'Priyanka Raman', role: 'CEO, former teacher' }, { name: 'Jonas Lindqvist', role: 'ML lead' }],
      target: 160_000, raised: 99_200, monthlyBudget: 11_000, feeCap: 1_500, daysAgo: 5,
    }),
    raising({
      id: 'harborloop', country: 'United Arab Emirates', name: 'Harborloop', ticker: 'HRBR', category: 'Fintech',
      tagline: 'Remittances that arrive as mobile money within a minute',
      about: 'Harborloop settles small cross-border transfers over stablecoin rails and pays out to mobile money wallets. Live on the Dubai to Lahore corridor, raising to license the next two.',
      founders: [{ name: 'Kwabena Mensah', role: 'CEO' }, { name: 'Leila Haddad', role: 'Compliance lead' }],
      target: 300_000, raised: 54_000, monthlyBudget: 18_000, feeCap: 3_000, daysAgo: 2,
    }),
  ]

  // One startup that already wound down, so the refund path can be seen.
  const dead = live({
    id: 'driftkiln', country: 'Norway', name: 'Driftkiln', ticker: 'DRFT', category: 'Consumer', seed: 83, hb: 'red', redDays: 60,
    tagline: 'Small-batch ceramics marketplace with kiln time booked by the hour',
    about: 'Driftkiln matched hobby potters with studios that had idle kiln hours. The team stopped shipping in the summer and the listing wound down after 60 silent days.',
    founders: [{ name: 'Oona Halvorsen', role: 'Founder' }],
    raised: 80_000, mult: 0.3, monthsLive: 5, monthlyBudget: 7_000, feeCap: 1_000, volumeTotal: 260_000, volume24h: 0, day: 0,
  })
  const pool = dead.treasury + dead.feeVault + dead.holderReserve + dead.poolUsdc
  dead.phase = 'wound_down'
  dead.refundPool = pool
  dead.refundPerToken = pool / dead.circulating
  dead.treasury = 0
  dead.feeVault = 0
  dead.holderReserve = 0
  dead.poolUsdc = 0
  dead.founderBurned = true
  dead.woundDownAt = Date.now() - 12 * dayMs
  dead.history = [...dead.history.slice(0, -1), dead.refundPerToken]
  list.push(dead)
  return list
}

export function seedHoldings(startups: Startup[]): Record<string, Holding> {
  const by = (id: string) => startups.find(s => s.id === id)!
  const h = (id: string, tokens: number, costMult: number): [string, Holding] => {
    const s = by(id)
    return [id, { tokens, cost: tokens * s.salePrice * costMult }]
  }
  return Object.fromEntries([h('northpane', 310_000, 1.6), h('lumenroute', 420_000, 1.5), h('driftkiln', 650_000, 0.9)])
}

const chk = (o: Partial<Checks>, name: string): Checks => ({
  ...allPassed(name.toLowerCase() + '.com', 'github.com/' + name.toLowerCase(), '@' + name.toLowerCase(), 9),
  ...o,
})

export function seedApplications(): Application[] {
  const base = (o: Partial<Application> & Pick<Application, 'id' | 'name' | 'ticker' | 'founderName' | 'submittedAt' | 'status' | 'checks'>): Application => ({
    mine: false,
    founderRole: 'Founder',
    country: 'United Kingdom',
    email: 'founder@' + o.name.toLowerCase() + '.com',
    tagline: '',
    about: '',
    category: 'Other',
    website: o.name.toLowerCase() + '.com',
    github: 'github.com/' + o.name.toLowerCase(),
    social: '@' + o.name.toLowerCase(),
    raiseTarget: 100_000,
    monthlyBudget: 8_000,
    feeCap: 1_200,
    ...o,
  })
  const now = Date.now()
  return [
    base({
      id: 'app-1', name: 'Cinderpath', ticker: 'CNDR', founderName: 'Yusuf Demir', country: 'Türkiye', category: 'Logistics',
      tagline: 'Cold-chain tracking tags that cost less than the box they ride in',
      about: 'Disposable temperature loggers with a QR readout, sold to regional food distributors.',
      raiseTarget: 140_000, monthlyBudget: 10_000, submittedAt: now - 11 * dayMs, status: 'in_review', checks: chk({}, 'Cinderpath'),
    }),
    base({
      id: 'app-2', name: 'Palewater', ticker: 'PALE', founderName: 'Ingrid Solberg', country: 'Norway', category: 'Health',
      tagline: 'Shift scheduling for home-care nurses that respects travel time',
      about: 'Builds weekly rosters for home-care agencies and re-plans the day when a visit overruns.',
      raiseTarget: 200_000, monthlyBudget: 15_000, submittedAt: now - 9 * dayMs, status: 'scheduled', scheduledFor: now + 3 * dayMs, decidedAt: now - 2 * dayMs,
      checks: chk({}, 'Palewater'),
    }),
    base({
      id: 'app-3', name: 'Tessel', ticker: 'TESL', founderName: 'Arjun Mehta', country: 'India', category: 'AI',
      tagline: 'Turns a product spec into a clickable prototype you can user-test the same day',
      about: 'Generates working front-end prototypes from written specs and records user-test sessions against them.',
      raiseTarget: 90_000, monthlyBudget: 7_000, submittedAt: now - 6 * dayMs, status: 'in_review',
      checks: chk({ github: pending('Waiting for the founder to connect the organisation account') }, 'Tessel'),
    }),
    base({
      id: 'app-4', name: 'Brackenfold', ticker: 'BRKN', founderName: 'Chloé Marchand', country: 'France', category: 'Climate',
      tagline: 'Insulation audits from a phone video of the outside of a house',
      about: 'Estimates heat loss from a walk-around video and prices the retrofit with local installers.',
      raiseTarget: 110_000, monthlyBudget: 9_000, submittedAt: now - 2 * dayMs, status: 'submitted',
      checks: chk({ domain: failed('No DNS record found on brackenfold.com'), kyc: pending('Identity check in progress') }, 'Brackenfold'),
    }),
    base({
      id: 'app-5', name: 'Glintware', ticker: 'GLNT', founderName: 'Unnamed applicant', country: 'Unknown', category: 'Consumer',
      tagline: 'Rewards app', about: 'No product description supplied.',
      submittedAt: now - 16 * dayMs, status: 'rejected', decidedAt: now - 8 * dayMs,
      rejectionReason: 'Domain registered four days before applying, empty repository, founder identity could not be confirmed.',
      checks: chk({ kyc: failed('Identity could not be confirmed'), github: failed('Repository has no commits'), founder: failed('Details do not match the documents provided') }, 'Glintware'),
    }),
  ]
}

export function seedDaily(): DayStat[] {
  const r = mulberry(404)
  const out: DayStat[] = []
  const today = Date.now()
  for (let i = 29; i >= 0; i--) {
    const trend = 1 + (29 - i) * 0.022
    const weekday = new Date(today - i * dayMs).getDay()
    const weekend = weekday === 0 || weekday === 6 ? 0.72 : 1
    const volume = Math.round((62_000 + r() * 58_000) * trend * weekend)
    const apps = r() < 0.3 ? 1 : r() < 0.06 ? 2 : 0
    const grad = i === 23 ? 3_750 : i === 12 ? 6_000 : i === 4 ? 3_000 : 0
    out.push({ date: isoDay(today - i * dayMs), volume: i === 0 ? 140_550 : volume, trading: (i === 0 ? 140_550 : volume) * FEE.platform, verification: apps * 300, graduation: grad })
  }
  return out
}

export function seedTrades(startups: Startup[]): Trade[] {
  const r = mulberry(909)
  const liveOnes = startups.filter(s => s.phase === 'live')
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const addr = () => Array.from({ length: 44 }, () => letters[Math.floor(r() * letters.length)]).join('')
  const out: Trade[] = []
  for (let i = 0; i < 14; i++) {
    const s = liveOnes[Math.floor(r() * liveOnes.length)]
    const p = s.poolUsdc / s.poolTokens
    const usdc = Math.round(40 + r() * r() * 2600)
    out.push({
      id: 'seed-' + i,
      startupId: s.id,
      side: r() < (s.heartbeat === 'red' ? 0.25 : 0.6) ? 'buy' : 'sell',
      usdc,
      tokens: usdc / p,
      price: p * (1 + (r() - 0.5) * 0.02),
      ts: Date.now() - Math.round((i * 11 + r() * 9) * 60_000),
      wallet: addr(),
      mine: false,
    })
  }
  return out
}

export const DEMO = DEMO_ADDRESS
