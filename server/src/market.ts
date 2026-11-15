// Read routes over the indexed data: trades, price history, wallet positions and admin numbers.
import type { FastifyInstance } from 'fastify'
import type { Deps } from './applications.ts'
import { guards } from './auth.ts'
import type { Db } from './db.ts'
import type { Trade } from './generated/prisma/client.ts'

const ui = (baseUnits: bigint) => Number(baseUnits) / 1e6
const DAY_MS = 86_400_000

/** The shape the frontend's `Trade` type expects. `price` is what this trade paid or got per token. */
export const tradeView = (t: Trade) => ({
  id: `${t.signature}-${t.eventIndex}`,
  startupId: t.ticker.toLowerCase(),
  side: t.side,
  usdc: ui(t.usdc),
  tokens: ui(t.tokens),
  price: Number(t.usdc) / Number(t.tokens),
  ts: t.ts.getTime(),
  wallet: t.wallet,
})

/** Market numbers for one startup's profile, all from indexed trades. */
export async function marketOf(db: Db, ticker: string, now = Date.now()) {
  const dayAgo = new Date(now - DAY_MS)
  // Volume is what moved through the pool: the payment on a buy, payout plus fee on a sell.
  const volume = async (since?: Date) => {
    const [paid, sellFees] = await Promise.all([
      db.trade.aggregate({ where: { ticker, side: { not: 'commit' }, ts: since && { gt: since } }, _sum: { usdc: true } }),
      db.trade.aggregate({ where: { ticker, side: 'sell', ts: since && { gt: since } }, _sum: { fee: true } }),
    ])
    return ui((paid._sum.usdc ?? 0n) + (sellFees._sum.fee ?? 0n))
  }
  const [recent, before, volume24h, volumeTotal, backers] = await Promise.all([
    db.trade.findMany({ where: { ticker }, orderBy: { ts: 'desc' }, take: 120, select: { price: true } }),
    db.trade.findFirst({ where: { ticker, ts: { lte: dayAgo } }, orderBy: { ts: 'desc' }, select: { price: true } }),
    volume(dayAgo),
    volume(),
    db.trade.findMany({ where: { ticker, side: 'commit' }, distinct: ['wallet'], select: { wallet: true } }),
  ])
  const history = recent.map(t => t.price).reverse()
  return {
    history,
    /** The price a day ago, or the first known price when the startup is younger than that. */
    openPrice24h: before?.price ?? history[0] ?? null,
    volume24h,
    volumeTotal,
    backers: backers.length,
  }
}

export function marketRoutes(app: FastifyInstance, { db, env }: Deps) {
  const { admin } = guards(env)
  const params = { type: 'object', properties: { id: { type: 'string', maxLength: 16 }, address: { type: 'string', maxLength: 64 } } }

  app.get('/trades', async () => (await db.trade.findMany({ orderBy: { ts: 'desc' }, take: 80 })).map(tradeView))

  app.get<{ Params: { id: string } }>('/startups/:id/trades', { schema: { params } }, async req =>
    (await db.trade.findMany({ where: { ticker: req.params.id.toUpperCase() }, orderBy: { ts: 'desc' }, take: 80 })).map(tradeView),
  )

  app.get<{ Params: { id: string } }>('/startups/:id/history', { schema: { params } }, async req => (await marketOf(db, req.params.id.toUpperCase())).history)

  /** Cost basis per startup (average cost: a sale removes its share of what was paid) and the wallet's activity. */
  app.get<{ Params: { address: string } }>('/wallets/:address/positions', { schema: { params } }, async req => {
    const trades = await db.trade.findMany({ where: { wallet: req.params.address }, orderBy: { ts: 'asc' } })
    const positions: Record<string, { tokens: number; cost: number }> = {}
    for (const t of trades) {
      const p = (positions[t.ticker.toLowerCase()] ??= { tokens: 0, cost: 0 })
      const [tokens, usdc] = [ui(t.tokens), ui(t.usdc)]
      if (t.side === 'sell') {
        const left = Math.max(0, p.tokens - tokens)
        p.cost = p.tokens > 0 ? p.cost * (left / p.tokens) : 0
        p.tokens = left
      } else {
        p.tokens += tokens
        p.cost += usdc
      }
    }
    return { positions, trades: trades.slice(-80).reverse().map(tradeView) }
  })

  /** Volume and platform revenue by source per day, oldest first, with empty days filled in. */
  app.get<{ Querystring: { range?: number } }>(
    '/admin/stats',
    { preHandler: admin, schema: { querystring: { type: 'object', properties: { range: { type: 'integer', minimum: 1, maximum: 365 } } } } },
    async req => {
      const range = req.query.range ?? 60
      const days = Array.from({ length: range }, (_, i) => new Date(Date.now() - (range - 1 - i) * DAY_MS).toISOString().slice(0, 10))
      const rows = await db.dailyStat.findMany({ where: { date: { gte: days[0] } } })
      return days.map(date => {
        const row = rows.find(r => r.date === date)
        return { date, volume: ui(row?.volume ?? 0n), trading: ui(row?.trading ?? 0n), verification: ui(row?.verification ?? 0n), graduation: ui(row?.graduation ?? 0n) }
      })
    },
  )
}
