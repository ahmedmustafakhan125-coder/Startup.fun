// Live mode: the same store actions as the mock, backed by the devnet program (VITE_DATA_SOURCE=live).
// Each action validates like the mock does, sends one transaction through the wallet, then re-reads
// the chain so the screen shows on-chain state.
import type { Address, Instruction } from '@solana/kit'
import { LIVE, sendWithWallet } from '../chain/client'
import { type Action, explain } from '../chain/errors'
import { exactBalance, loadChain, type Ref, refOf } from '../chain/read'
import { buyTx, claimFeesTx, claimFounderTokensTx, claimRefundTx, claimTreasuryTx, commitTx, faucetTx, sellTx, toBase } from '../chain/tx'
import { DEMO_AIRDROP } from '../config'
import { claimableFees, claimableTreasury, founderClaimable, quoteBuy, quoteSell } from '../lib/curve'
import type { Result, Trade } from './types'
import type { Actions, Data } from './useStore'

/** How far the price may move against the trader between the quote and the transaction. */
const SLIPPAGE = 0.01
const REFRESH_MS = 20_000

type Store = Data & Actions
type AddTrade = (t: Omit<Trade, 'id' | 'ts' | 'wallet' | 'mine'>) => void

/** Live mode starts empty and fills from the chain. Applications and admin numbers stay sample data until Phases 6 and 8. */
export const liveSeed = (data: Data): Data => ({
  ...data,
  startups: [],
  trades: [],
  holdings: {},
  wallet: { address: null, kind: null, usdc: 0 },
})

export function liveActions(
  set: (patch: Partial<Store> | ((state: Store) => Partial<Store>)) => void,
  get: () => Store,
  addTrade: AddTrade,
): Partial<Actions> {
  const refresh = async () => {
    const owner = get().wallet.address as Address | null
    const snapshot = await loadChain(owner, get().holdings)
    // Ignore the answer if the wallet changed while it was loading.
    if (get().wallet.address !== owner) return
    set(st => ({ startups: snapshot.startups, holdings: snapshot.holdings, wallet: { ...st.wallet, usdc: snapshot.usdc } }))
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
      set({ wallet: { kind, address: address ?? null, usdc: 0 }, holdings: {} })
      void refresh().catch(() => {})
    },
    disconnect: () => set({ wallet: { kind: null, address: null, usdc: 0 }, holdings: {} }),
    airdrop: () => send('usdc', null, owner => faucetTx(owner, toBase(DEMO_AIRDROP))),

    commit: async (id, usdc) => {
      const s = find(id)
      if (!s || s.phase !== 'raising') return { ok: false, error: 'This raise is closed.' }
      if (usdc <= 0) return { ok: false, error: 'Enter an amount.' }
      if (usdc > get().wallet.usdc) return { ok: false, error: 'Not enough USDC. Use the faucet in Portfolio.' }
      const amount = Math.min(usdc, s.raiseTarget - s.raised)
      const r = await send('usdc', id, (owner, ref) => commitTx(owner, ref, toBase(amount)))
      if (!r.ok) return r
      addTrade({ startupId: id, side: 'commit', usdc: amount, tokens: amount / s.salePrice, price: s.salePrice })
      return { ...r, message: find(id)?.phase === 'live' ? 'Raise filled. Trading is open.' : undefined }
    },

    buy: async (id, usdc) => {
      const s = find(id)
      if (!s || s.phase !== 'live') return { ok: false, error: 'Trading is not open for this startup.' }
      if (usdc <= 0) return { ok: false, error: 'Enter an amount.' }
      if (usdc > get().wallet.usdc) return { ok: false, error: 'Not enough USDC. Use the faucet in Portfolio.' }
      const q = quoteBuy(s, usdc)
      const r = await send('usdc', id, (owner, ref) => buyTx(owner, ref, toBase(usdc), toBase(q.tokensOut * (1 - SLIPPAGE))))
      if (r.ok) addTrade({ startupId: id, side: 'buy', usdc, tokens: q.tokensOut, price: q.avg })
      return r
    },

    sell: async (id, tokens) => {
      const s = find(id)
      if (!s || s.phase !== 'live') return { ok: false, error: 'Trading is not open for this startup.' }
      const held = get().holdings[id]?.tokens ?? 0
      if (tokens <= 0) return { ok: false, error: 'Enter an amount.' }
      if (tokens > held + 1e-6) return { ok: false, error: 'You do not hold that many tokens.' }
      const q = quoteSell(s, tokens)
      const r = await send('sell', id, async (owner, ref) => {
        // Selling everything uses the exact on-chain balance, so no dust is left behind.
        const tokensIn = tokens >= held ? await exactBalance(owner, ref.mint) : toBase(tokens)
        return sellTx(owner, ref, tokensIn, toBase(q.usdcOut * (1 - SLIPPAGE)))
      })
      if (r.ok) addTrade({ startupId: id, side: 'sell', usdc: q.usdcOut, tokens, price: q.gross / tokens })
      return r
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
