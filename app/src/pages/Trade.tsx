import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AreaChart } from '../components/Charts'
import { Coin } from '../components/Coin'
import { Change } from '../components/StartupRow'
import { TradePanel } from '../components/TradePanel'
import { Empty, Icon, PageHead, Panel, Progress, Stat, StatusBadge, cx } from '../components/ui'
import { change24h, floorPerToken, mcapOf, priceOf } from '../lib/curve'
import { ago, compact, pctPlain, price, shortAddr, usd, usdCompact } from '../lib/format'
import { rankTraders } from '../lib/leaderboard'
import { useStore } from '../store/useStore'
import type { Startup } from '../store/types'

const LEADERS_SHOWN = 10

/** One coin in the market list. */
function MarketRow({ s, on, pick }: { s: Startup; on: boolean; pick: () => void }) {
  return (
    <button onClick={pick} aria-pressed={on} className={cx('row-line flex w-full items-center gap-3 px-4 py-3 text-left transition first:border-t-0 hover:bg-white/[.04]', on && 'bg-white/[.07]')}>
      <Coin label={s.ticker} size={34} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-tight">{s.ticker}</span>
        <span className="block truncate text-sm text-ink3">{s.name}</span>
      </span>
      <span className="text-right">
        <span className="block font-semibold leading-tight">{price(priceOf(s))}</span>
        <span className="block text-sm">{s.phase === 'raising' ? <span className="text-bluehi">Raising</span> : <Change value={change24h(s)} />}</span>
      </span>
    </button>
  )
}

export default function Trade() {
  const startups = useStore(st => st.startups)
  const trades = useStore(st => st.trades)
  const serverLeaders = useStore(st => st.leaders)
  const wallet = useStore(st => st.wallet.address)
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')

  // Coins that can be bought now: open markets first, by volume, then open raises.
  const markets = useMemo(
    () =>
      startups
        .filter(s => s.phase !== 'wound_down')
        .sort((a, b) => Number(b.phase === 'live') - Number(a.phase === 'live') || b.volume24h - a.volume24h || b.listedAt - a.listedAt),
    [startups],
  )
  const needle = q.trim().toLowerCase()
  const shown = markets.filter(s => !needle || (s.name + ' ' + s.ticker).toLowerCase().includes(needle))
  const s = markets.find(m => m.id === params.get('m')) ?? markets[0]
  const pick = (id: string) => setParams({ m: id }, { replace: true })

  // The server ranks every trade it has indexed. Without it, rank the trades this page knows about.
  const leaders = useMemo(() => (serverLeaders.length ? serverLeaders : rankTraders(trades)), [serverLeaders, trades])
  const myRank = wallet ? leaders.findIndex(l => l.wallet === wallet) : -1
  const top = leaders[0]?.volume ?? 0

  if (!s)
    return (
      <div>
        <PageHead title="Trade" />
        <Empty
          title="No coins to trade yet"
          body="A coin shows up here as soon as a startup is listed. Its raise opens first, and trading opens when the raise closes."
          action={
            <Link to="/list" className="btn btn-lime">
              List a startup
            </Link>
          }
        />
      </div>
    )

  const live = s.phase === 'live'
  const recent = trades.filter(t => t.startupId === s.id).slice(0, 8)

  return (
    <div>
      <PageHead title="Trade" lead="Buy and sell startup coins straight from the pool. Every trade pays a 1% fee, and part of it is held back for holders." />

      {/* Small screens pick a coin from a strip, large screens from the list on the left. */}
      <div className="scroll-x -mx-4 mb-4 flex gap-2 px-4 sm:mx-0 sm:px-0 lg:hidden">
        {markets.map(m => (
          <button key={m.id} className="chip" data-on={m.id === s.id} onClick={() => pick(m.id)}>
            {m.ticker}
            <span className="text-ink3">{price(priceOf(m))}</span>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[250px_minmax(0,1fr)_360px]">
        <aside className="glass hidden overflow-hidden lg:sticky lg:top-[96px] lg:block">
          <div className="p-3">
            <label className="relative block">
              <span className="sr-only">Search coins</span>
              <Icon name="search" size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3" />
              <input className="input !h-10 !pl-10 text-[15px]" placeholder="Search coins" value={q} onChange={e => setQ(e.target.value)} />
            </label>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {shown.map(m => (
              <MarketRow key={m.id} s={m} on={m.id === s.id} pick={() => pick(m.id)} />
            ))}
            {shown.length === 0 && <p className="m-0 px-4 pb-5 pt-2 text-sm text-ink2">No coin matches that search.</p>}
          </div>
        </aside>

        <div className="grid min-w-0 grid-cols-1 gap-5">
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3.5">
                <Coin key={s.id} label={s.ticker} size={52} land />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h2 className="truncate text-[24px]">{s.name}</h2>
                    <span className="text-ink3">{s.ticker}</span>
                    <StatusBadge s={s} compact />
                  </div>
                  <div className="truncate text-sm text-ink2">{s.tagline}</div>
                </div>
              </div>
              <Link to={`/s/${s.id}`} className="btn btn-glass btn-sm">
                About this startup
              </Link>
            </div>
            <div className="mt-5 flex items-baseline gap-3">
              <span className="font-display text-[40px] font-semibold leading-none">{price(priceOf(s))}</span>
              {live ? <Change value={change24h(s)} className="text-[17px]" /> : <span className="text-ink2">fixed price until the raise closes</span>}
            </div>
            {live ? (
              <div className="mt-3">
                <AreaChart key={s.id} data={s.history} height={230} format={price} name={`${s.ticker} price`} />
              </div>
            ) : (
              <div className="mt-6">
                <div className="mb-2 flex items-baseline justify-between text-[15px]">
                  <span className="font-semibold">{usd(s.raised)} raised</span>
                  <span className="text-ink2">of {usd(s.raiseTarget)}</span>
                </div>
                <Progress value={s.raised / s.raiseTarget} tone="blue" height={10} />
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/[.07] pt-5 sm:grid-cols-4 lg:grid-cols-2">
              {live ? (
                <>
                  <Stat label="Market cap" value={usdCompact(mcapOf(s))} />
                  <Stat label="Volume today" value={usdCompact(s.volume24h)} />
                  <Stat label="Pool liquidity" value={usdCompact(s.poolUsdc)} />
                  <Stat label="Refund floor" value={price(floorPerToken(s))} />
                </>
              ) : (
                <>
                  <Stat label="Committed" value={pctPlain(s.raised / s.raiseTarget)} />
                  <Stat label="Backers" value={String(s.backers)} />
                  <Stat label="Target" value={usdCompact(s.raiseTarget)} />
                  <Stat label="Value at this price" value={usdCompact(mcapOf(s))} />
                </>
              )}
            </div>
          </Panel>

          <div className="lg:hidden">
            <TradePanel key={s.id} s={s} />
          </div>

          <Panel pad={false}>
            <h2 className="px-5 pt-5 text-[22px] sm:px-7 sm:pt-6">Latest {s.ticker} trades</h2>
            {recent.length ? (
              <div className="mt-3 pb-2">
                {recent.map(t => (
                  <div key={t.id} className="row-line grid grid-cols-[70px_1fr_auto] items-center gap-3 px-5 py-3 text-[15px] sm:grid-cols-[80px_1fr_1fr_auto] sm:px-7">
                    <span className={t.side === 'sell' ? 'font-semibold text-red' : 'font-semibold text-lime'}>{t.side === 'commit' ? 'Commit' : t.side === 'buy' ? 'Buy' : 'Sell'}</span>
                    <span>
                      {usd(t.usdc, 2)} <span className="text-ink3">for {compact(t.tokens)} {s.ticker}</span>
                    </span>
                    <span className="hidden text-ink3 sm:block">{t.mine ? 'You' : shortAddr(t.wallet)}</span>
                    <span className="text-right text-ink3">{ago(t.ts)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-5 pb-6 pt-2 text-ink2 sm:px-7">No trades yet. Yours would be the first.</p>
            )}
          </Panel>
        </div>

        <aside className="hidden lg:sticky lg:top-[96px] lg:block">
          <TradePanel key={s.id} s={s} />
        </aside>
      </div>

      {/* Leaderboard */}
      <section className="mt-16" aria-labelledby="leaders">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="leaders" className="text-[28px] sm:text-[34px]" style={{ fontStretch: '85%' }}>
              Top traders
            </h2>
            <p className="mt-1 text-ink2">Wallets ranked by how much they have bought and sold. Backing a raise does not count.</p>
          </div>
          {myRank >= 0 && (
            <span className="badge badge-green">
              You are number {myRank + 1} of {leaders.length}
            </span>
          )}
        </div>
        {leaders.length ? (
          <div className="glass overflow-hidden">
            <div className="hidden grid-cols-[56px_minmax(0,1.2fr)_90px_110px_minmax(0,1fr)] gap-4 px-6 pb-2 pt-4 text-sm text-ink3 sm:grid">
              <span>Rank</span>
              <span>Trader</span>
              <span className="text-right">Trades</span>
              <span>Trades most</span>
              <span className="text-right">Volume</span>
            </div>
            {leaders
              .map((l, i) => ({ l, i }))
              .filter(({ l, i }) => i < LEADERS_SHOWN || l.wallet === wallet)
              .map(({ l, i }) => {
                const me = l.wallet === wallet
                const fav = startups.find(x => x.id === l.top)
                return (
                  <div
                    key={l.wallet}
                    className={cx('swap-in row-line grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 first:border-t-0 sm:grid-cols-[56px_minmax(0,1.2fr)_90px_110px_minmax(0,1fr)] sm:px-6', me && 'bg-lime/[.06]')}
                    style={{ animationDelay: `${Math.min(i, LEADERS_SHOWN) * 45}ms` }}
                  >
                    <span>{i < 3 ? <Coin label={String(i + 1)} size={32} /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-white/[.06] text-sm font-semibold text-ink2">{i + 1}</span>}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold">{shortAddr(l.wallet)}</span>
                        {me && <span className="badge badge-green">You</span>}
                      </span>
                      <span className="block text-sm text-ink3 sm:hidden">
                        {l.trades} {l.trades === 1 ? 'trade' : 'trades'}
                        {fav && `, mostly ${fav.ticker}`}
                      </span>
                    </span>
                    <span className="hidden text-right sm:block">{l.trades}</span>
                    <span className="hidden sm:block">
                      {fav ? (
                        <button className="inline-flex items-center gap-2 font-semibold hover:text-lime" onClick={() => {
                            if (fav.phase === 'wound_down') return
                            pick(fav.id)
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}>
                          <Coin label={fav.ticker} size={22} />
                          {fav.ticker}
                        </button>
                      ) : (
                        <span className="text-ink3">{l.top.toUpperCase()}</span>
                      )}
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold">{usd(l.volume)}</span>
                      <span className="mt-1.5 hidden sm:block">
                        <Progress value={top > 0 ? l.volume / top : 0} height={4} tone={i < 3 ? 'lime' : 'mute'} />
                      </span>
                    </span>
                  </div>
                )
              })}
          </div>
        ) : (
          <Empty title="No trades yet" body="The first wallet to buy or sell a coin takes the top spot." />
        )}
      </section>
    </div>
  )
}
