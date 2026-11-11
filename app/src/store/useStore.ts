import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  DEMO_ADDRESS,
  DEMO_AIRDROP,
  FEE,
  GRADUATION_FEE,
  SUPPLY,
  TREASURY_SHARE,
  VERIFICATION_FEE,
  WINDDOWN_DAYS,
} from '../config'
import { allPassed, seedApplications, seedDaily, seedHoldings, seedStartups, seedTrades } from '../data/seed'
import {
  claimableFees,
  claimableTreasury,
  founderClaimable,
  quoteBuy,
  quoteSell,
} from '../lib/curve'
import { dayMs, isoDay } from '../lib/format'
import type { Application, DayStat, Draft, Heartbeat, Holding, Result, Startup, Trade } from './types'

// This store is the whole "backend" for now. Every action below maps to one
// program instruction or API call later, so pages never touch the data directly.

const memory = new Map<string, string>()
const safeStorage = {
  getItem: (k: string) => {
    try {
      return window.localStorage.getItem(k)
    } catch {
      return memory.get(k) ?? null
    }
  },
  setItem: (k: string, v: string) => {
    try {
      window.localStorage.setItem(k, v)
    } catch {
      memory.set(k, v)
    }
  },
  removeItem: (k: string) => {
    try {
      window.localStorage.removeItem(k)
    } catch {
      memory.delete(k)
    }
  },
}

const newCode = () => 'obverse-verify=' + Math.random().toString(36).slice(2, 10)

export const emptyDraft = (): Draft => ({
  step: 0,
  founderName: '',
  founderRole: '',
  country: '',
  email: '',
  name: '',
  ticker: '',
  tagline: '',
  about: '',
  category: 'AI',
  website: '',
  github: '',
  social: '',
  raiseTarget: 100_000,
  monthlyBudget: 8_000,
  feeCap: 1_200,
  verified: { kyc: false, domain: false, github: false, socials: false },
  code: newCode(),
})

interface Wallet {
  address: string | null
  kind: 'demo' | 'phantom' | null
  usdc: number
}

interface Data {
  startups: Startup[]
  applications: Application[]
  trades: Trade[]
  daily: DayStat[]
  month: number
  wallet: Wallet
  holdings: Record<string, Holding>
  draft: Draft
}

interface Actions {
  connect: (kind: 'demo' | 'phantom', address?: string) => void
  disconnect: () => void
  airdrop: () => void
  commit: (id: string, usdc: number) => Result
  buy: (id: string, usdc: number) => Result
  sell: (id: string, tokens: number) => Result
  claimRefund: (id: string) => Result
  setDraft: (patch: Partial<Draft>) => void
  resetDraft: () => void
  submitApplication: () => Result
  adminRunChecks: (appId: string) => void
  adminSchedule: (appId: string, when: number) => void
  adminReject: (appId: string, reason: string) => void
  adminListNow: (appId: string) => Result
  adminCloseRaise: (id: string) => Result
  adminSetHeartbeat: (id: string, hb: Heartbeat) => void
  adminAdvanceMonth: () => string[]
  founderClaimTreasury: (id: string) => Result
  founderClaimFees: (id: string) => Result
  founderClaimTokens: (id: string) => Result
  resetDemo: () => void
}

const seed = (): Data => {
  const startups = seedStartups()
  return {
    startups,
    applications: seedApplications(),
    trades: seedTrades(startups),
    daily: seedDaily(),
    month: 0,
    wallet: { address: null, kind: null, usdc: 12_400 },
    holdings: seedHoldings(startups),
    draft: emptyDraft(),
  }
}

const bumpToday = (daily: DayStat[], patch: Partial<Record<'volume' | 'trading' | 'verification' | 'graduation', number>>) => {
  const today = isoDay(Date.now())
  const list = daily.slice(-60)
  let last = list[list.length - 1]
  if (!last || last.date !== today) {
    last = { date: today, volume: 0, trading: 0, verification: 0, graduation: 0 }
    list.push(last)
  } else {
    last = { ...last }
    list[list.length - 1] = last
  }
  last.volume += patch.volume ?? 0
  last.trading += patch.trading ?? 0
  last.verification += patch.verification ?? 0
  last.graduation += patch.graduation ?? 0
  return list
}

const pushPrice = (history: number[], p: number) => [...history.slice(-119), p]

// Close a raise: take the graduation fee, lock 80% in the treasury, seed the pool with the rest.
function openTrading(s: Startup): { startup: Startup; fee: number } {
  const fee = s.raised * GRADUATION_FEE
  const net = s.raised - fee
  const poolUsdc = net * (1 - TREASURY_SHARE)
  const poolTokens = Math.min(SUPPLY.liquidity, poolUsdc / s.salePrice)
  const p = poolUsdc / poolTokens
  return {
    fee,
    startup: {
      ...s,
      phase: 'live',
      poolUsdc,
      poolTokens,
      treasury: net * TREASURY_SHARE,
      history: [s.salePrice, p],
      openPrice24h: p,
      lastBeat: Date.now(),
    },
  }
}

function windDown(s: Startup): Startup {
  const pool = s.treasury + s.feeVault + s.holderReserve + s.poolUsdc
  const per = s.circulating > 0 ? pool / s.circulating : 0
  return {
    ...s,
    phase: 'wound_down',
    refundPool: pool,
    refundPerToken: per,
    treasury: 0,
    feeVault: 0,
    holderReserve: 0,
    poolUsdc: 0,
    founderBurned: true,
    woundDownAt: Date.now(),
    history: pushPrice(s.history, per),
    volume24h: 0,
  }
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'startup'

export const useStore = create<Data & Actions>()(
  persist(
    (set, get) => {
      const patchStartup = (id: string, fn: (s: Startup) => Startup) =>
        set(st => ({ startups: st.startups.map(s => (s.id === id ? fn(s) : s)) }))
      const find = (id: string) => get().startups.find(s => s.id === id)
      const addTrade = (t: Omit<Trade, 'id' | 'ts' | 'wallet' | 'mine'>) =>
        set(st => ({
          trades: [
            { ...t, id: 't' + Date.now() + Math.random().toString(36).slice(2, 6), ts: Date.now(), wallet: st.wallet.address ?? DEMO_ADDRESS, mine: true },
            ...st.trades,
          ].slice(0, 80),
        }))
      const needWallet = (): string | null => (get().wallet.address ? null : 'Connect a wallet first.')

      return {
        ...seed(),

        connect: (kind, address) => set(st => ({ wallet: { ...st.wallet, kind, address: address ?? DEMO_ADDRESS } })),
        disconnect: () => set(st => ({ wallet: { ...st.wallet, kind: null, address: null } })),
        airdrop: () => set(st => ({ wallet: { ...st.wallet, usdc: st.wallet.usdc + DEMO_AIRDROP } })),

        commit: (id, usdc) => {
          const err = needWallet()
          if (err) return { ok: false, error: err }
          const s = find(id)
          if (!s || s.phase !== 'raising') return { ok: false, error: 'This raise is closed.' }
          const room = s.raiseTarget - s.raised
          if (usdc <= 0) return { ok: false, error: 'Enter an amount.' }
          if (usdc > get().wallet.usdc) return { ok: false, error: 'Not enough USDC. Use the faucet in Portfolio.' }
          const amount = Math.min(usdc, room)
          const tokens = amount / s.salePrice
          let next: Startup = { ...s, raised: s.raised + amount, circulating: s.circulating + tokens, backers: s.backers + 1 }
          let gradFee = 0
          const filled = next.raised >= next.raiseTarget - 0.005
          if (filled) {
            const r = openTrading(next)
            next = r.startup
            gradFee = r.fee
          }
          set(st => ({
            startups: st.startups.map(x => (x.id === id ? next : x)),
            wallet: { ...st.wallet, usdc: st.wallet.usdc - amount },
            holdings: {
              ...st.holdings,
              [id]: { tokens: (st.holdings[id]?.tokens ?? 0) + tokens, cost: (st.holdings[id]?.cost ?? 0) + amount },
            },
            daily: gradFee ? bumpToday(st.daily, { graduation: gradFee }) : st.daily,
          }))
          addTrade({ startupId: id, side: 'commit', usdc: amount, tokens, price: s.salePrice })
          return { ok: true, message: filled ? 'Raise filled. Trading is open.' : undefined }
        },

        buy: (id, usdc) => {
          const err = needWallet()
          if (err) return { ok: false, error: err }
          const s = find(id)
          if (!s || s.phase !== 'live') return { ok: false, error: 'Trading is not open for this startup.' }
          if (usdc <= 0) return { ok: false, error: 'Enter an amount.' }
          if (usdc > get().wallet.usdc) return { ok: false, error: 'Not enough USDC. Use the faucet in Portfolio.' }
          const q = quoteBuy(s, usdc)
          const poolUsdc = s.poolUsdc + q.net
          const poolTokens = s.poolTokens - q.tokensOut
          set(st => ({
            startups: st.startups.map(x =>
              x.id === id
                ? {
                    ...x,
                    poolUsdc,
                    poolTokens,
                    circulating: x.circulating + q.tokensOut,
                    feeVault: x.feeVault + usdc * FEE.startup,
                    holderReserve: x.holderReserve + usdc * FEE.reserve,
                    volume24h: x.volume24h + usdc,
                    volumeTotal: x.volumeTotal + usdc,
                    history: pushPrice(x.history, poolUsdc / poolTokens),
                  }
                : x,
            ),
            wallet: { ...st.wallet, usdc: st.wallet.usdc - usdc },
            holdings: {
              ...st.holdings,
              [id]: { tokens: (st.holdings[id]?.tokens ?? 0) + q.tokensOut, cost: (st.holdings[id]?.cost ?? 0) + usdc },
            },
            daily: bumpToday(st.daily, { volume: usdc, trading: usdc * FEE.platform }),
          }))
          addTrade({ startupId: id, side: 'buy', usdc, tokens: q.tokensOut, price: q.avg })
          return { ok: true }
        },

        sell: (id, tokens) => {
          const err = needWallet()
          if (err) return { ok: false, error: err }
          const s = find(id)
          if (!s || s.phase !== 'live') return { ok: false, error: 'Trading is not open for this startup.' }
          const held = get().holdings[id]?.tokens ?? 0
          if (tokens <= 0) return { ok: false, error: 'Enter an amount.' }
          if (tokens > held + 1e-6) return { ok: false, error: 'You do not hold that many tokens.' }
          const q = quoteSell(s, tokens)
          const poolUsdc = s.poolUsdc - q.gross
          const poolTokens = s.poolTokens + tokens
          set(st => {
            const h = st.holdings[id]
            const left = Math.max(0, h.tokens - tokens)
            const holdings = { ...st.holdings }
            if (left < 1e-6) delete holdings[id]
            else holdings[id] = { tokens: left, cost: h.cost * (left / h.tokens) }
            return {
              startups: st.startups.map(x =>
                x.id === id
                  ? {
                      ...x,
                      poolUsdc,
                      poolTokens,
                      circulating: x.circulating - tokens,
                      feeVault: x.feeVault + q.gross * FEE.startup,
                      holderReserve: x.holderReserve + q.gross * FEE.reserve,
                      volume24h: x.volume24h + q.gross,
                      volumeTotal: x.volumeTotal + q.gross,
                      history: pushPrice(x.history, poolUsdc / poolTokens),
                    }
                  : x,
              ),
              wallet: { ...st.wallet, usdc: st.wallet.usdc + q.usdcOut },
              holdings,
              daily: bumpToday(st.daily, { volume: q.gross, trading: q.gross * FEE.platform }),
            }
          })
          addTrade({ startupId: id, side: 'sell', usdc: q.usdcOut, tokens, price: q.gross / tokens })
          return { ok: true }
        },

        claimRefund: id => {
          const err = needWallet()
          if (err) return { ok: false, error: err }
          const s = find(id)
          const h = get().holdings[id]
          if (!s || s.phase !== 'wound_down' || !h) return { ok: false, error: 'Nothing to refund here.' }
          const amount = Math.min(s.refundPool, h.tokens * s.refundPerToken)
          set(st => {
            const holdings = { ...st.holdings }
            delete holdings[id]
            return {
              holdings,
              wallet: { ...st.wallet, usdc: st.wallet.usdc + amount },
              startups: st.startups.map(x => (x.id === id ? { ...x, refundPool: x.refundPool - amount, circulating: x.circulating - h.tokens } : x)),
            }
          })
          return { ok: true, message: amount.toFixed(2) }
        },

        setDraft: patch => set(st => ({ draft: { ...st.draft, ...patch } })),
        resetDraft: () => set({ draft: emptyDraft() }),

        submitApplication: () => {
          const err = needWallet()
          if (err) return { ok: false, error: err }
          const st = get()
          const d = st.draft
          if (st.wallet.usdc < VERIFICATION_FEE) return { ok: false, error: `The verification fee is ${VERIFICATION_FEE} USDC. Use the faucet in Portfolio.` }
          const now = Date.now()
          const checks = allPassed(d.website, d.github, d.social, 0)
          checks.kyc.detail = 'Sandbox identity check passed'
          checks.founder = { status: 'pending', detail: 'A reviewer compares founder details by hand', checkedAt: null }
          const app: Application = {
            id: 'app-' + now,
            mine: true,
            founderName: d.founderName,
            founderRole: d.founderRole,
            country: d.country,
            email: d.email,
            name: d.name,
            ticker: d.ticker.toUpperCase(),
            tagline: d.tagline,
            about: d.about,
            category: d.category,
            website: d.website,
            github: d.github,
            social: d.social,
            raiseTarget: d.raiseTarget,
            monthlyBudget: d.monthlyBudget,
            feeCap: d.feeCap,
            checks,
            status: 'submitted',
            submittedAt: now,
          }
          set({
            applications: [app, ...st.applications],
            wallet: { ...st.wallet, usdc: st.wallet.usdc - VERIFICATION_FEE },
            daily: bumpToday(st.daily, { verification: VERIFICATION_FEE }),
            draft: emptyDraft(),
          })
          return { ok: true }
        },

        adminRunChecks: appId =>
          set(st => ({
            applications: st.applications.map(a => {
              if (a.id !== appId) return a
              const checks = { ...a.checks }
              ;(Object.keys(checks) as (keyof typeof checks)[]).forEach(k => {
                if (checks[k].status !== 'passed')
                  checks[k] = { status: 'passed', detail: 'Re-run by a reviewer and passed', checkedAt: Date.now() }
              })
              return { ...a, checks, status: a.status === 'submitted' ? 'in_review' : a.status }
            }),
          })),

        adminSchedule: (appId, when) =>
          set(st => ({
            applications: st.applications.map(a => (a.id === appId ? { ...a, status: 'scheduled', scheduledFor: when, decidedAt: Date.now() } : a)),
          })),

        adminReject: (appId, reason) =>
          set(st => ({
            applications: st.applications.map(a => (a.id === appId ? { ...a, status: 'rejected', rejectionReason: reason, decidedAt: Date.now() } : a)),
          })),

        adminListNow: appId => {
          const st = get()
          const a = st.applications.find(x => x.id === appId)
          if (!a) return { ok: false, error: 'Application not found.' }
          if (Object.values(a.checks).some(c => c.status !== 'passed')) return { ok: false, error: 'Every check must pass before listing.' }
          let id = slug(a.name)
          if (st.startups.some(s => s.id === id)) id = id + '-' + String(Date.now()).slice(-4)
          const salePrice = a.raiseTarget / SUPPLY.sale
          const startup: Startup = {
            id,
            name: a.name,
            ticker: a.ticker,
            tagline: a.tagline,
            about: a.about || a.tagline,
            category: a.category,
            country: a.country,
            website: a.website,
            github: a.github,
            social: a.social,
            founders: [{ name: a.founderName, role: a.founderRole || 'Founder' }],
            mine: a.mine,
            listedAt: Date.now(),
            phase: 'raising',
            heartbeat: 'green',
            redDays: 0,
            lastBeat: Date.now(),
            beats: Array(14).fill(1),
            checks: a.checks,
            raiseTarget: a.raiseTarget,
            raised: 0,
            salePrice,
            backers: 0,
            poolUsdc: 0,
            poolTokens: 0,
            circulating: 0,
            treasury: 0,
            treasuryReleased: 0,
            monthlyBudget: a.monthlyBudget,
            treasuryClaimedThisMonth: 0,
            feeVault: 0,
            feeCap: a.feeCap,
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
          set({
            startups: [startup, ...st.startups],
            applications: st.applications.map(x => (x.id === appId ? { ...x, status: 'listed', startupId: id, decidedAt: x.decidedAt ?? Date.now() } : x)),
          })
          return { ok: true, message: id }
        },

        adminCloseRaise: id => {
          const s = find(id)
          if (!s || s.phase !== 'raising') return { ok: false, error: 'This raise is already closed.' }
          if (s.raised <= 0) return { ok: false, error: 'Nothing has been committed yet.' }
          const r = openTrading(s)
          set(st => ({
            startups: st.startups.map(x => (x.id === id ? r.startup : x)),
            daily: bumpToday(st.daily, { graduation: r.fee }),
          }))
          return { ok: true }
        },

        adminSetHeartbeat: (id, hb) =>
          patchStartup(id, s => ({
            ...s,
            heartbeat: hb,
            redDays: hb === 'green' ? 0 : Math.max(1, s.redDays),
            lastBeat: hb === 'green' ? Date.now() : s.lastBeat,
            beats: [...s.beats.slice(1), hb === 'green' ? 1 : 0],
            checks:
              hb === 'green'
                ? Object.fromEntries(
                    Object.entries(s.checks).map(([k, c]) => [k, c.status === 'failed' ? { status: 'passed', detail: 'Back online and passing', checkedAt: Date.now() } : c]),
                  ) as Startup['checks']
                : {
                    ...s.checks,
                    domain: { status: 'failed', detail: `${s.website} did not respond to the last check`, checkedAt: Date.now() },
                  },
          })),

        // The demo clock. One call is one month for every live startup.
        adminAdvanceMonth: () => {
          const wound: string[] = []
          set(st => ({
            month: st.month + 1,
            startups: st.startups.map(s => {
              if (s.phase !== 'live') return s
              if (s.heartbeat === 'green')
                return {
                  ...s,
                  vestMonths: s.vestMonths + 1,
                  treasuryClaimedThisMonth: 0,
                  feesClaimedThisMonth: 0,
                  redDays: 0,
                  lastBeat: Date.now(),
                  beats: [...s.beats.slice(2), 1, 1],
                  openPrice24h: s.poolUsdc / s.poolTokens,
                  volume24h: 0,
                }
              const redDays = s.redDays + 30
              const next = { ...s, redDays, beats: [...s.beats.slice(2), 0, 0] }
              if (redDays >= WINDDOWN_DAYS) {
                wound.push(s.name)
                return windDown(next)
              }
              return next
            }),
          }))
          return wound
        },

        founderClaimTreasury: id => {
          const s = find(id)
          if (!s) return { ok: false, error: 'Startup not found.' }
          const amount = claimableTreasury(s)
          if (amount <= 0) return { ok: false, error: s.heartbeat === 'red' ? 'Payouts are paused while the heartbeat is red.' : 'This month’s budget is already claimed.' }
          set(st => ({
            startups: st.startups.map(x =>
              x.id === id ? { ...x, treasury: x.treasury - amount, treasuryReleased: x.treasuryReleased + amount, treasuryClaimedThisMonth: x.treasuryClaimedThisMonth + amount } : x,
            ),
            wallet: { ...st.wallet, usdc: st.wallet.usdc + amount },
          }))
          return { ok: true, message: amount.toFixed(2) }
        },

        founderClaimFees: id => {
          const s = find(id)
          if (!s) return { ok: false, error: 'Startup not found.' }
          const amount = claimableFees(s)
          if (amount <= 0) return { ok: false, error: s.heartbeat === 'red' ? 'Payouts are paused while the heartbeat is red.' : 'Nothing to claim under this month’s cap.' }
          set(st => ({
            startups: st.startups.map(x =>
              x.id === id ? { ...x, feeVault: x.feeVault - amount, feesClaimedThisMonth: x.feesClaimedThisMonth + amount, feesClaimedTotal: x.feesClaimedTotal + amount } : x,
            ),
            wallet: { ...st.wallet, usdc: st.wallet.usdc + amount },
          }))
          return { ok: true, message: amount.toFixed(2) }
        },

        founderClaimTokens: id => {
          const s = find(id)
          if (!s) return { ok: false, error: 'Startup not found.' }
          const amount = founderClaimable(s)
          if (amount <= 0) return { ok: false, error: 'No tokens have unlocked yet.' }
          set(st => ({
            startups: st.startups.map(x => (x.id === id ? { ...x, founderClaimed: x.founderClaimed + amount, circulating: x.circulating + amount } : x)),
            holdings: { ...st.holdings, [id]: { tokens: (st.holdings[id]?.tokens ?? 0) + amount, cost: st.holdings[id]?.cost ?? 0 } },
          }))
          return { ok: true, message: String(Math.round(amount)) }
        },

        resetDemo: () => set({ ...seed() }),
      }
    },
    {
      name: 'obverse-demo-v2',
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ startups, applications, trades, daily, month, wallet, holdings, draft }) => ({
        startups,
        applications,
        trades,
        daily,
        month,
        wallet,
        holdings,
        draft,
      }),
    },
  ),
)

// Small non-persisted UI store: toasts and the connect dialog.
export interface Toast {
  id: number
  title: string
  body?: string
  tone: 'ok' | 'error' | 'info'
  coin?: string
}
interface Ui {
  toasts: Toast[]
  connectOpen: boolean
  toast: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
  openConnect: (open: boolean) => void
}
let toastId = 1
export const useUi = create<Ui>(set => ({
  toasts: [],
  connectOpen: false,
  toast: t => {
    const id = toastId++
    set(s => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })), 4600)
  },
  dismiss: id => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })),
  openConnect: open => set({ connectOpen: open }),
}))

export const dayAgo = (n: number) => Date.now() - n * dayMs
