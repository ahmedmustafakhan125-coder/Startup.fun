import { Link } from 'react-router-dom'
import { Coin } from '../components/Coin'
import { Change, coinTone } from '../components/StartupRow'
import { Empty, PageHead, Panel, StatusBadge } from '../components/ui'
import { DEMO_AIRDROP } from '../config'
import { priceOf } from '../lib/curve'
import { ago, compact, price, usd } from '../lib/format'
import { useStore, useUi } from '../store/useStore'

export default function Portfolio() {
  const wallet = useStore(s => s.wallet)
  const holdings = useStore(s => s.holdings)
  const startups = useStore(s => s.startups)
  const trades = useStore(s => s.trades).filter(t => t.mine).slice(0, 10)
  const { airdrop, claimRefund } = useStore.getState()
  const { toast, openConnect } = useUi()

  if (!wallet.address)
    return (
      <div>
        <PageHead title="Portfolio" />
        <Empty
          title="Connect a wallet to see your positions"
          body="The demo wallet comes with demo USDC and three positions, including one refund you can claim."
          action={
            <button className="btn btn-lime" onClick={() => openConnect(true)}>
              Connect wallet
            </button>
          }
        />
      </div>
    )

  const rows = Object.entries(holdings)
    .map(([id, h]) => ({ s: startups.find(x => x.id === id), h }))
    .filter((r): r is { s: NonNullable<typeof r.s>; h: typeof r.h } => !!r.s)
    .map(r => ({ ...r, value: r.h.tokens * priceOf(r.s) }))
    .sort((a, b) => b.value - a.value)
  const invested = rows.reduce((a, r) => a + r.value, 0)
  const cost = rows.reduce((a, r) => a + r.h.cost, 0)

  return (
    <div>
      <PageHead
        title="Portfolio"
        right={
          <button
            className="btn btn-glass"
            onClick={() => {
              airdrop()
              toast({ tone: 'ok', title: `Added ${usd(DEMO_AIRDROP)} demo USDC` })
            }}
          >
            Get {usd(DEMO_AIRDROP)} demo USDC
          </button>
        }
      />
      <Panel>
        <dl className="m-0 grid grid-cols-2 gap-6 md:grid-cols-4">
          {[
            ['Total', usd(invested + wallet.usdc, 2)],
            ['In startups', usd(invested, 2)],
            ['USDC', usd(wallet.usdc, 2)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm text-ink3">{k}</dt>
              <dd className="m-0 mt-1 font-display text-[30px] font-semibold leading-none">{v}</dd>
            </div>
          ))}
          <div>
            <dt className="text-sm text-ink3">Gain or loss</dt>
            <dd className="m-0 mt-1 flex items-baseline gap-2">
              <span className="font-display text-[30px] font-semibold leading-none">{(invested - cost < 0 ? '-' : '+') + usd(Math.abs(invested - cost), 2)}</span>
              {cost > 0 && <Change value={invested / cost - 1} />}
            </dd>
          </div>
        </dl>
      </Panel>

      <h2 className="mb-4 mt-10 text-[26px]">Positions</h2>
      {rows.length ? (
        <div className="glass overflow-hidden">
          {rows.map(({ s, h, value }) => {
            const dead = s.phase === 'wound_down'
            const gain = h.cost > 0 ? value / h.cost - 1 : 0
            return (
              <div key={s.id} className="row-line grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 px-4 py-4 first:border-t-0 sm:px-6 md:grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto]">
                <Link to={`/s/${s.id}`} className="coin-host flex min-w-0 items-center gap-3.5">
                  <Coin label={s.ticker} size={46} hover tone={coinTone(s)} />
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[18px] font-semibold">{s.name}</span>
                    <span className="mt-1 block">
                      <StatusBadge s={s} compact />
                    </span>
                  </span>
                </Link>
                <div className="text-right md:text-left">
                  <div className="font-semibold">
                    {compact(h.tokens)} {s.ticker}
                  </div>
                  <div className="text-sm text-ink3">{dead ? 'refund ' : 'at '}{price(priceOf(s))}</div>
                </div>
                <div>
                  <div className="font-semibold">{usd(value, 2)}</div>
                  <div className="text-sm">{h.cost > 0 ? <Change value={gain} /> : <span className="text-ink3">claimed allocation</span>}</div>
                </div>
                <div className="text-right">
                  {dead ? (
                    <button
                      className="btn btn-lime btn-sm"
                      onClick={() => {
                        const r = claimRefund(s.id)
                        r.ok ? toast({ tone: 'ok', title: `Refunded ${usd(Number(r.message), 2)}`, body: `${compact(h.tokens)} ${s.ticker} redeemed`, coin: s.ticker }) : toast({ tone: 'error', title: 'Refund failed', body: r.error })
                      }}
                    >
                      Claim refund
                    </button>
                  ) : (
                    <Link to={`/s/${s.id}`} className="btn btn-glass btn-sm">
                      {s.phase === 'raising' ? 'View raise' : 'Trade'}
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Empty
          title="No positions yet"
          body="Back an open raise or buy a token that is already trading."
          action={
            <Link to="/explore" className="btn btn-lime">
              Explore startups
            </Link>
          }
        />
      )}

      <h2 className="mb-4 mt-10 text-[26px]">Your activity</h2>
      {trades.length ? (
        <div className="glass overflow-hidden">
          {trades.map(t => {
            const s = startups.find(x => x.id === t.startupId)
            return (
              <div key={t.id} className="row-line grid grid-cols-[80px_1fr_auto] items-center gap-3 px-4 py-3 text-[15px] first:border-t-0 sm:px-6">
                <span className={t.side === 'sell' ? 'font-semibold text-red' : 'font-semibold text-lime'}>{t.side === 'commit' ? 'Commit' : t.side === 'buy' ? 'Buy' : 'Sell'}</span>
                <span>
                  {compact(t.tokens)} {s?.ticker} <span className="text-ink3">for {usd(t.usdc, 2)}</span>
                </span>
                <span className="text-ink3">{ago(t.ts)}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-ink2">Trades you make will show up here.</p>
      )}
    </div>
  )
}
