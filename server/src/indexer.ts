// The indexer: reads every program transaction once, decodes its events, and writes trades and
// daily numbers. It works from the signature list, so a restart continues where it stopped and a
// replay never double-counts (ARCHITECTURE.md 5.6).
import {
  getApplicationFeePaidEventDecoder,
  getCommittedEventDecoder,
  getFeesClaimedEventDecoder,
  getRaiseClosedEventDecoder,
  getTradedEventDecoder,
  identifyObverseEvent,
  ObverseEvent,
  programEvents,
  Side,
} from '../../sdk/src/index.ts'
import type { Chain } from './chain.ts'
import type { Db } from './db.ts'

interface TradeRow {
  eventIndex: number
  startup: string
  side: 'buy' | 'sell' | 'commit'
  wallet: string
  usdc: bigint
  tokens: bigint
  fee: bigint
  /** USDC per token after the trade. */
  price: number
}
export interface Decoded {
  trades: TradeRow[]
  /** Base units. Volume counts what moved through the pool: the payment on a buy, the gross on a sell. */
  volume: bigint
  trading: bigint
  verification: bigint
  graduation: bigint
  feesClaimed: { startup: string; amount: bigint }[]
}

/** Everything the indexer keeps from one transaction's logs. */
export function decodeLogs(logs: readonly string[]): Decoded {
  const out: Decoded = { trades: [], volume: 0n, trading: 0n, verification: 0n, graduation: 0n, feesClaimed: [] }
  programEvents(logs).forEach((data, eventIndex) => {
    let kind: ObverseEvent
    try {
      kind = identifyObverseEvent(data)
    } catch {
      return // not an event this client knows
    }
    if (kind === ObverseEvent.Traded) {
      const e = getTradedEventDecoder().decode(data)
      const buy = e.side === Side.Buy
      out.trades.push({ eventIndex, startup: e.startup, side: buy ? 'buy' : 'sell', wallet: e.trader, usdc: e.usdcAmount, tokens: e.tokenAmount, fee: e.fee, price: Number(e.priceAfter) / 1e12 })
      out.volume += buy ? e.usdcAmount : e.usdcAmount + e.fee
      out.trading += e.feePlatform
    } else if (kind === ObverseEvent.Committed) {
      const e = getCommittedEventDecoder().decode(data)
      out.trades.push({ eventIndex, startup: e.startup, side: 'commit', wallet: e.buyer, usdc: e.usdcIn, tokens: e.tokensOut, fee: 0n, price: Number(e.usdcIn) / Number(e.tokensOut) })
    } else if (kind === ObverseEvent.RaiseClosed) out.graduation += getRaiseClosedEventDecoder().decode(data).listingFee
    else if (kind === ObverseEvent.ApplicationFeePaid) out.verification += getApplicationFeePaidEventDecoder().decode(data).amount
    else if (kind === ObverseEvent.FeesClaimed) {
      const e = getFeesClaimedEventDecoder().decode(data)
      out.feesClaimed.push({ startup: e.startup, amount: e.amount })
    }
  })
  return out
}

/** Writes one transaction's rows and marks its signature done, all or nothing. */
async function store(db: Db, chain: Pick<Chain, 'tickerOf'>, signature: string, blockTime: number, decoded: Decoded | null) {
  const ts = new Date(blockTime * 1000)
  const writes = []
  if (decoded) {
    for (const t of decoded.trades) {
      const ticker = await chain.tickerOf(t.startup)
      if (ticker) writes.push(db.trade.create({ data: { signature, eventIndex: t.eventIndex, ticker, side: t.side, wallet: t.wallet, usdc: t.usdc, tokens: t.tokens, fee: t.fee, price: t.price, ts } }))
    }
    const { volume, trading, verification, graduation } = decoded
    if (volume || trading || verification || graduation) {
      const add = { volume: { increment: volume }, trading: { increment: trading }, verification: { increment: verification }, graduation: { increment: graduation } }
      writes.push(db.dailyStat.upsert({ where: { date: ts.toISOString().slice(0, 10) }, create: { date: ts.toISOString().slice(0, 10), volume, trading, verification, graduation }, update: add }))
    }
    for (const claim of decoded.feesClaimed) {
      const ticker = await chain.tickerOf(claim.startup)
      if (ticker) writes.push(db.startup.updateMany({ where: { ticker }, data: { feesClaimed: { increment: claim.amount } } }))
    }
  }
  // The signature row is unique, so a transaction that was already stored fails here and writes nothing.
  await db.$transaction([db.indexedSignature.create({ data: { signature, ts } }), ...writes])
}

/** One pass: every program transaction not yet indexed, oldest first. Runs on a timer in index.ts. */
export async function runIndexer({ db, chain }: { db: Db; chain: Pick<Chain, 'signaturesSince' | 'logsOf' | 'tickerOf'> }): Promise<number> {
  const last = await db.indexedSignature.findFirst({ orderBy: { ts: 'desc' } })
  let indexed = 0
  for (const { signature, failed, blockTime } of await chain.signaturesSince(last?.signature)) {
    if (await db.indexedSignature.findUnique({ where: { signature } })) continue
    const logs = failed ? null : await chain.logsOf(signature)
    // Not readable yet: stop here and pick it up on the next pass, so nothing is skipped.
    if (!failed && !logs) break
    await store(db, chain, signature, blockTime, logs && decodeLogs(logs))
    indexed++
  }
  return indexed
}
