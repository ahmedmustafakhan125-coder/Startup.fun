import type { Leader, Trade } from '../store/types'

/** Ranks wallets by what they traded through the pools. Raise commits are not pool volume, so they do not count. */
export function rankTraders(trades: Pick<Trade, 'wallet' | 'side' | 'usdc' | 'startupId'>[]): Leader[] {
  const board = new Map<string, { volume: number; trades: number; byStartup: Map<string, number> }>()
  for (const t of trades) {
    if (t.side === 'commit') continue
    const row = board.get(t.wallet) ?? { volume: 0, trades: 0, byStartup: new Map<string, number>() }
    row.volume += t.usdc
    row.trades += 1
    row.byStartup.set(t.startupId, (row.byStartup.get(t.startupId) ?? 0) + t.usdc)
    board.set(t.wallet, row)
  }
  return [...board]
    .map(([wallet, row]) => ({ wallet, volume: row.volume, trades: row.trades, top: [...row.byStartup].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 50)
}
