import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Chain } from '../src/chain.ts'
import { decodeLogs, runIndexer } from '../src/indexer.ts'
import { signIn, testApp, wallet } from './helpers.ts'

type Json = Record<string, any> // test-only: responses are inspected field by field

// Four real devnet transactions, recorded with their logs: a commit that fills QUIL's 90,000 USDC
// raise (and so closes it), a 900 USDC buy, a sale of 10,000 tokens, and a verification fee.
const recorded = JSON.parse(readFileSync(new URL('./fixtures/transactions.json', import.meta.url), 'utf8')) as {
  startups: Record<string, string>
  transactions: { name: string; signature: string; blockTime: number; logs: string[] }[]
}
const [commit, buy, sell, fee] = recorded.transactions as unknown as [Json, Json, Json, Json]

/** A chain that serves the recorded transactions, newest known signature last. */
function replay(visible = recorded.transactions.length): Pick<Chain, 'signaturesSince' | 'logsOf' | 'tickerOf'> {
  const txs = recorded.transactions.slice(0, visible)
  return {
    signaturesSince: async until => {
      const from = until ? txs.findIndex(t => t.signature === until) + 1 : 0
      return [...txs.slice(from).map(t => ({ signature: t.signature, failed: false, blockTime: t.blockTime })), { signature: 'failed-tx', failed: true, blockTime: 1 }]
    },
    logsOf: async signature => txs.find(t => t.signature === signature)?.logs ?? null,
    tickerOf: async startup => recorded.startups[startup] ?? null,
  }
}

describe('event decoding', () => {
  it('reads trades, fees and the fee split from real logs', () => {
    const closing = decodeLogs(commit.logs)
    expect(closing.trades).toMatchObject([{ side: 'commit', usdc: 90_000_000_000n, tokens: 65_000_000_000_000n }])
    expect(closing.graduation).toBe(2_250_000_000n) // 2.5% listing fee
    expect(closing.volume).toBe(0n) // a commit is not pool volume

    const bought = decodeLogs(buy.logs)
    expect(bought.trades).toMatchObject([{ side: 'buy', usdc: 900_000_000n, fee: 9_000_000n }])
    expect(bought.volume).toBe(900_000_000n)
    expect(bought.trading).toBe(2_700_000n) // the platform's 0.30%

    const sold = decodeLogs(sell.logs)
    expect(sold.trades).toMatchObject([{ side: 'sell', tokens: 10_000_000_000n }])
    expect(sold.volume).toBe(sold.trades[0]!.usdc + sold.trades[0]!.fee) // gross: payout plus fee

    expect(decodeLogs(fee.logs)).toMatchObject({ trades: [], verification: 300_000_000n })
  })

  it('ignores event bytes that another program logged', () => {
    const forged = buy.logs.map((line: string) => line.replace(/^Program \S+ invoke \[1\]$/, 'Program Fake111111111111111111111111111111111111 invoke [1]'))
    expect(decodeLogs(forged).trades).toEqual([])
  })
})

describe('indexer', () => {
  it('stores every transaction once, survives a restart, and serves the numbers', async () => {
    const { app, db, admin } = await testApp()
    await db.startup.create({ data: { ticker: 'QUIL', name: 'Quillstack', founderWallet: 'f', address: Object.keys(recorded.startups)[0]!, mint: 'm' } })

    // First run sees two transactions, then the server "restarts" and the chain has moved on.
    expect(await runIndexer({ db, chain: replay(2) })).toBe(3) // two recorded + one failed transaction
    expect(await db.trade.count()).toBe(2)
    expect(await runIndexer({ db, chain: replay() })).toBe(2)
    expect(await runIndexer({ db, chain: replay() })).toBe(0) // nothing new: nothing written
    expect(await db.trade.count()).toBe(3)
    expect(await db.indexedSignature.count()).toBe(recorded.transactions.length + 1)

    // Revenue: 0.30% of volume, plus listing and verification fees, to the cent.
    const boss = await signIn(app, admin)
    const stats = (await app.inject({ method: 'GET', url: '/admin/stats?range=365', headers: { cookie: boss } })).json<Json[]>()
    const sum = (key: string) => stats.reduce((total, day) => total + day[key], 0)
    expect(stats).toHaveLength(365)
    expect(sum('trading')).toBeCloseTo(sum('volume') * 0.003, 2)
    expect(sum('graduation')).toBe(2250)
    expect(sum('verification')).toBe(300)
    expect((await app.inject({ method: 'GET', url: '/admin/stats', headers: { cookie: await signIn(app, await wallet()) } })).statusCode).toBe(403)

    // Trades, the startup's market numbers, and the buyer's cost basis.
    const trades = (await app.inject({ method: 'GET', url: '/startups/quil/trades' })).json<Json[]>()
    expect(trades.map(t => t.side)).toEqual(['sell', 'buy', 'commit'])
    expect(trades[2]).toMatchObject({ startupId: 'quil', usdc: 90_000, tokens: 65_000_000 })
    expect((await app.inject({ method: 'GET', url: '/trades' })).json<Json[]>()).toHaveLength(3)

    // The leaderboard counts the buy and the sale (gross), not the raise commit.
    const leaders = (await app.inject({ method: 'GET', url: '/leaderboard' })).json<Json[]>()
    expect(leaders).toHaveLength(1)
    expect(leaders[0]).toMatchObject({ wallet: trades[0]!.wallet, trades: 2, top: 'quil' })
    expect(leaders[0]!.volume).toBeCloseTo(sum('volume'), 6)

    const profile = (await app.inject({ method: 'GET', url: '/startups/quil' })).json<Json>()
    expect(profile).toMatchObject({ backers: 1, volumeTotal: sum('volume'), feesClaimedTotal: 0 })
    expect(profile.history).toHaveLength(3)
    expect(profile.history[1]).toBeGreaterThan(profile.history[0]) // the buy moved the price up

    const { positions } = (await app.inject({ method: 'GET', url: `/wallets/${trades[0]!.wallet}/positions` })).json<Json>()
    const held = 65_000_000 + trades[1]!.tokens - 10_000
    expect(positions.quil.tokens).toBeCloseTo(held, 3)
    expect(positions.quil.cost).toBeCloseTo((90_900 * held) / (held + 10_000), 2) // the sale removed its share of the cost
  })
})
