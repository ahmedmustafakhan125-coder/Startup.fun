// Live mode: the same store actions as the mock, backed by the devnet program (VITE_DATA_SOURCE=live).
// Each action validates like the mock does, sends one transaction through the wallet, then re-reads
// the chain so the screen shows on-chain state.
import type { Address, Instruction } from '@solana/kit'
import { api, ApiError, type FormFields, type ServerApplication, setApiWallet, signIn } from '../api/client'
import { LIVE, sendWithWallet, UserError } from '../chain/client'
import { type Action, explain } from '../chain/errors'
import { exactBalance, loadChain, type Ref, refOf } from '../chain/read'
import { buyTx, claimFeesTx, claimFounderTokensTx, claimRefundTx, claimTreasuryTx, commitTx, faucetTx, payVerificationFeeTx, sellTx, toBase } from '../chain/tx'
import { DEMO_AIRDROP, VERIFICATION_FEE } from '../config'
import { claimableFees, claimableTreasury, founderClaimable, quoteBuy, quoteSell } from '../lib/curve'
import type { Draft, Result } from './types'
import { type Actions, type Data, emptyDraft } from './useStore'

/** How far the price may move against the trader between the quote and the transaction. */
const SLIPPAGE = 0.01
const REFRESH_MS = 20_000

type Store = Data & Actions

/** Sixty days of zeros: what the charts show before, or without, admin numbers. */
const emptyDays = () =>
  Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.now() - (59 - i) * 86_400_000).toISOString().slice(0, 10), volume: 0, trading: 0, verification: 0, graduation: 0 }))

/** Live mode starts empty and fills from the chain and the API. Nothing from the sample data is kept. */
export const liveSeed = (data: Data): Data => ({
  ...data,
  startups: [],
  applications: [],
  daily: emptyDays(),
  month: 0,
  trades: [],
  holdings: {},
  wallet: { address: null, kind: null, usdc: 0 },
})

export function liveActions(
  set: (patch: Partial<Store> | ((state: Store) => Partial<Store>)) => void,
  get: () => Store,
): Partial<Actions> {
  const refresh = async () => {
    const owner = get().wallet.address as Address | null
    setApiWallet(owner)
    // The server is optional for reading: without it startups still load, with blank profiles.
    const [profiles, trades, positions, me] = await Promise.all([
      api.startups().catch(() => []),
      api.trades().catch(() => []),
      owner ? api.positions(owner).then(p => p.positions).catch(() => ({})) : {},
      owner ? api.me() : null,
    ])
    const snapshot = await loadChain(owner, profiles, positions)
    const signedIn = me?.address === owner
    const applications = !signedIn ? [] : await (me.admin ? api.adminApplications() : api.mine()).catch(() => [])
    const flags = signedIn && me.admin ? await api.flags().catch(() => []) : []
    // Admin numbers are for admins; everyone else sees an empty chart, never sample data.
    const daily = signedIn && me.admin ? await api.stats().catch(() => []) : []
    // Ignore the answer if the wallet changed while it was loading.
    if (get().wallet.address !== owner) return
    set(st => ({
      startups: snapshot.startups,
      holdings: snapshot.holdings,
      wallet: { ...st.wallet, usdc: snapshot.usdc },
      applications: applications.map(a => ({ ...a, mine: a.wallet === owner })),
      flags,
      trades: trades.map(t => ({ ...t, mine: t.wallet === owner })),
      daily: daily.length ? daily : emptyDays(),
    }))
  }

  const fields = (d: Draft): FormFields => ({
    founderName: d.founderName, founderRole: d.founderRole, country: d.country, email: d.email, name: d.name, ticker: d.ticker.toUpperCase(),
    tagline: d.tagline, about: d.about, category: d.category, website: d.website.trim().toLowerCase(), github: d.github, social: d.social,
    raiseTarget: d.raiseTarget, monthlyBudget: d.monthlyBudget, feeCap: d.feeCap,
  })
  /** Saves the wizard's draft on the server and takes over its id, DNS record and check results. */
  const saveDraft = async (): Promise<ServerApplication> => {
    const a = await api.saveDraft(fields(get().draft))
    const passed = (key: keyof Draft['verified']) => a.checks[key].status === 'passed'
    set(st => ({ draft: { ...st.draft, id: a.id, code: a.code, verified: { kyc: passed('kyc'), domain: passed('domain'), github: passed('github'), socials: passed('socials') } } }))
    return a
  }
  const problem = (error: unknown) => (error instanceof ApiError || error instanceof UserError ? error.message : explain(error, 'usdc'))
  /** Runs one server call for an admin action and re-reads state. */
  const server = async (call: () => Promise<ServerApplication | unknown>): Promise<Result> => {
    try {
      const answer = (await call()) as Partial<ServerApplication> | undefined
      await refresh().catch(() => {})
      return { ok: true, message: answer?.startupId }
    } catch (error) {
      return { ok: false, error: problem(error) }
    }
  }

  /** Sends one transaction for the connected wallet and re-reads the chain. */
  const send = async (action: Action, id: string | null, build: (owner: Address, ref: Ref) => Promise<Instruction[]>): Promise<Result> => {
    const owner = get().wallet.address as Address | null
    if (!owner) return { ok: false, error: 'Connect a wallet first.' }
    const ref = id ? refOf(id) : ({} as Ref)
    if (!ref) return { ok: false, error: 'Startup not found.' }
    try {
      const signature = await sendWithWallet(owner, await build(owner, ref))
      await refresh().catch(() => {}) // the transaction went through; the next poll will catch up
      return { ok: true, signature }
    } catch (error) {
      return { ok: false, error: explain(error, action) }
    }
  }
  const find = (id: string) => get().startups.find(s => s.id === id)

  return {
    refresh,
    connect: (kind, address) => {
      // A draft's server id and fee payment belong to one wallet.
      const sameWallet = get().wallet.address === address
      set(st => ({
        wallet: { kind, address: address ?? null, usdc: 0 },
        holdings: {},
        draft: sameWallet ? st.draft : { ...st.draft, id: undefined, feeSignature: undefined },
      }))
      void (async () => {
        await refresh().catch(() => {})
        // One signature right after connecting signs the wallet in to the backend.
        if (address && (await api.me())?.address !== address) {
          await signIn(address).catch(() => {})
          await refresh().catch(() => {})
        }
      })()
    },
    disconnect: () => {
      set({ wallet: { kind: null, address: null, usdc: 0 }, holdings: {}, applications: [], flags: [] })
      setApiWallet(null)
      void api.logout()
    },

    syncDraft: async () => {
      if (get().wallet.address) await saveDraft().catch(() => {}) // a failure shows when a check is run
    },
    verifyCheck: async key => {
      if (!get().wallet.address) return { ok: false, error: 'Connect a wallet first.' }
      try {
        const { id } = await saveDraft()
        const answer = await api.verify(id, key)
        if (answer.redirect) {
          window.location.href = api.url(answer.redirect) // GitHub sign-in; it returns to this form
          return { ok: true }
        }
        const passed = answer.check?.status === 'passed'
        set(st => ({ draft: { ...st.draft, verified: { ...st.draft.verified, [key]: passed } } }))
        return passed ? { ok: true } : { ok: false, error: answer.check?.detail ?? 'The check did not pass.' }
      } catch (error) {
        return { ok: false, error: problem(error) }
      }
    },
    submitApplication: async () => {
      const owner = get().wallet.address as Address | null
      if (!owner) return { ok: false, error: 'Connect a wallet first.' }
      const paid = get().draft.feeSignature
      if (!paid && get().wallet.usdc < VERIFICATION_FEE) return { ok: false, error: `The verification fee is ${VERIFICATION_FEE} USDC. Use the faucet in Portfolio.` }
      try {
        const { id } = await saveDraft()
        // Never take the fee for an application the server would refuse.
        if (Object.values(get().draft.verified).some(passed => !passed)) return { ok: false, error: 'Pass the four checks before submitting.' }
        // Pay once: the signature is kept in the saved draft, so a retry after a failed submit reuses it.
        const feeSignature = paid ?? (await sendWithWallet(owner, await payVerificationFeeTx(owner, id)))
        set(st => ({ draft: { ...st.draft, feeSignature } }))
        await api.submit({ ...fields(get().draft), id, feeSignature })
        set({ draft: emptyDraft() })
        await refresh().catch(() => {})
        return { ok: true, signature: feeSignature }
      } catch (error) {
        return { ok: false, error: problem(error) }
      }
    },
    adminRunChecks: id => server(() => api.runChecks(id)),
    adminSchedule: (id, when) => server(() => api.schedule(id, when)),
    adminReject: (id, reason) => server(() => api.reject(id, reason)),
    adminListNow: id => server(() => api.listNow(id)),
    adminCloseRaise: id => server(() => api.closeRaise(id)),
    adminSetHeartbeat: (id, hb, reason) => server(() => api.setHeartbeat(id, hb, reason)),
    resolveFlag: (id, resolution) => server(() => api.resolveFlag(id, resolution)),
    postUpdate: (id, body) => server(() => api.postUpdate(id, body)),
    airdrop: () => send('usdc', null, owner => faucetTx(owner, toBase(DEMO_AIRDROP))),

    commit: async (id, usdc) => {
      const s = find(id)
      if (!s || s.phase !== 'raising') return { ok: false, error: 'This raise is closed.' }
      if (usdc <= 0) return { ok: false, error: 'Enter an amount.' }
      if (usdc > get().wallet.usdc) return { ok: false, error: 'Not enough USDC. Use the faucet in Portfolio.' }
      const amount = Math.min(usdc, s.raiseTarget - s.raised)
      const r = await send('usdc', id, (owner, ref) => commitTx(owner, ref, toBase(amount)))
      if (!r.ok) return r
      return { ...r, message: find(id)?.phase === 'live' ? 'Raise filled. Trading is open.' : undefined }
    },

    buy: async (id, usdc) => {
      const s = find(id)
      if (!s || s.phase !== 'live') return { ok: false, error: 'Trading is not open for this startup.' }
      if (usdc <= 0) return { ok: false, error: 'Enter an amount.' }
      if (usdc > get().wallet.usdc) return { ok: false, error: 'Not enough USDC. Use the faucet in Portfolio.' }
      const q = quoteBuy(s, usdc)
      return send('usdc', id, (owner, ref) => buyTx(owner, ref, toBase(usdc), toBase(q.tokensOut * (1 - SLIPPAGE))))
    },

    sell: async (id, tokens) => {
      const s = find(id)
      if (!s || s.phase !== 'live') return { ok: false, error: 'Trading is not open for this startup.' }
      const held = get().holdings[id]?.tokens ?? 0
      if (tokens <= 0) return { ok: false, error: 'Enter an amount.' }
      if (tokens > held + 1e-6) return { ok: false, error: 'You do not hold that many tokens.' }
      const q = quoteSell(s, tokens)
      return send('sell', id, async (owner, ref) => {
        // Selling everything uses the exact on-chain balance, so no dust is left behind.
        const tokensIn = tokens >= held ? await exactBalance(owner, ref.mint) : toBase(tokens)
        return sellTx(owner, ref, tokensIn, toBase(q.usdcOut * (1 - SLIPPAGE)))
      })
    },

    claimRefund: async id => {
      const s = find(id)
      const h = get().holdings[id]
      if (!s || s.phase !== 'wound_down' || !h) return { ok: false, error: 'Nothing to refund here.' }
      const amount = Math.min(s.refundPool, h.tokens * s.refundPerToken)
      const r = await send('refund', id, async (owner, ref) => claimRefundTx(owner, ref, await exactBalance(owner, ref.mint)))
      return r.ok ? { ...r, message: amount.toFixed(2) } : r
    },

    founderClaimTreasury: async id => {
      const s = find(id)
      if (!s) return { ok: false, error: 'Startup not found.' }
      const amount = claimableTreasury(s)
      if (amount <= 0) return { ok: false, error: s.heartbeat === 'red' ? 'Payouts are paused while the heartbeat is red.' : 'Nothing to claim under this month’s cap.' }
      const r = await send('claim', id, claimTreasuryTx)
      return r.ok ? { ...r, message: amount.toFixed(2) } : r
    },

    founderClaimFees: async id => {
      const s = find(id)
      if (!s) return { ok: false, error: 'Startup not found.' }
      const amount = claimableFees(s)
      if (amount <= 0) return { ok: false, error: s.heartbeat === 'red' ? 'Payouts are paused while the heartbeat is red.' : 'Nothing to claim under this month’s cap.' }
      const r = await send('claim', id, claimFeesTx)
      return r.ok ? { ...r, message: amount.toFixed(2) } : r
    },

    founderClaimTokens: async id => {
      const s = find(id)
      if (!s) return { ok: false, error: 'Startup not found.' }
      const amount = founderClaimable(s)
      if (amount <= 0) return { ok: false, error: 'No tokens have unlocked yet.' }
      const r = await send('claim', id, claimFounderTokensTx)
      return r.ok ? { ...r, message: String(Math.round(amount)) } : r
    },
  }
}

/** Loads chain state now and keeps it fresh. Call once at start-up; does nothing in mock mode. */
export function startLiveSync(refresh: () => Promise<void>) {
  if (!LIVE) return
  const tick = () => void refresh().catch(() => {}) // a failed poll just leaves the last good state
  tick()
  setInterval(tick, REFRESH_MS)
}
