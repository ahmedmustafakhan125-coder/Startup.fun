import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AreaChart } from '../components/Charts'
import { Beats, Checklist } from '../components/Checklist'
import { Coin } from '../components/Coin'
import { Change, coinTone } from '../components/StartupRow'
import { TradePanel } from '../components/TradePanel'
import { Empty, Icon, Panel, Progress, StatusBadge } from '../components/ui'
import { CLIFF_MONTHS, SUPPLY, VEST_MONTHS, WINDDOWN_DAYS } from '../config'
import { change24h, floorPerToken, mcapOf, priceOf, runwayMonths, vestedTokens } from '../lib/curve'
import { ago, compact, dateLong, pctPlain, price, shortAddr, usd, usdCompact } from '../lib/format'
import { useStore } from '../store/useStore'
import type { Startup } from '../store/types'

function Vault({ icon, title, amount, children }: { icon: string; title: string; amount: string; children: ReactNode }) {
  return (
    <div className="glass-flat p-5">
      <div className="flex items-center gap-2.5 text-ink2">
        <Icon name={icon} />
        <span className="font-semibold">{title}</span>
      </div>
      <div className="mt-3 font-display text-[28px] font-semibold leading-none">{amount}</div>
      <div className="mt-3 text-[15px] text-ink2">{children}</div>
    </div>
  )
}

function Money({ s }: { s: Startup }) {
  const raisedNet = s.treasury + s.treasuryReleased
  const floor = floorPerToken(s)
  const p = priceOf(s)
  const vested = vestedTokens(s)
  const lockProgress = Math.min(1, s.vestMonths / (CLIFF_MONTHS + VEST_MONTHS))
  return (
    <Panel>
      <h2 className="text-[24px]">Where the money is</h2>
      <p className="mt-1.5 text-ink2">Founders never hold the raise. Each balance below sits in its own vault and pays out by rule.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Vault icon="vault" title="Raise treasury" amount={usd(s.treasury)}>
          {raisedNet > 0 ? (
            <>
              <Progress value={s.treasuryReleased / raisedNet} tone="blue" />
              <div className="mt-2.5">
                {usd(s.treasuryReleased)} released so far. Pays {usd(s.monthlyBudget)} a month, about {runwayMonths(s).toFixed(1)} months left.
              </div>
            </>
          ) : (
            <>Fills when the raise closes. It will pay {usd(s.monthlyBudget)} a month.</>
          )}
        </Vault>
        <Vault icon="chart" title="Startup fee vault" amount={usd(s.feeVault, 2)}>
          0.30% of every trade lands here. Founders can take at most {usd(s.feeCap)} a month. {usd(s.feesClaimedTotal)} claimed to date.
        </Vault>
        <Vault icon="shield" title="Holder reserve" amount={usd(s.holderReserve, 2)}>
          0.20% of every trade. Founders cannot touch it. It is paid to holders if the startup winds down.
        </Vault>
        <Vault icon="lock" title="Founder tokens" amount={s.founderBurned ? 'Burned' : compact(SUPPLY.founders - s.founderClaimed)}>
          {s.founderBurned ? (
            <>The locked allocation was burned at wind-down.</>
          ) : (
            <>
              <Progress value={lockProgress} tone="lime" marker={CLIFF_MONTHS / (CLIFF_MONTHS + VEST_MONTHS)} />
              <div className="mt-2.5">
                Month {s.vestMonths} of {CLIFF_MONTHS + VEST_MONTHS}. Locked for {CLIFF_MONTHS} months, then released evenly. {compact(vested)} unlocked so far.
              </div>
            </>
          )}
        </Vault>
      </div>
      {s.phase === 'live' && (
        <div className="mt-4 flex gap-3 rounded-2xl border border-bluehi/25 bg-blue/15 p-4">
          <Icon name="refresh" className="mt-0.5 text-bluehi" />
          <p className="m-0 text-[15px]">
            If {s.name} wound down today, holders would get back about <strong>{price(floor)}</strong> per token, {pctPlain(p > 0 ? floor / p : 0)} of the current price.
          </p>
        </div>
      )}
    </Panel>
  )
}

export default function StartupPage() {
  const { id } = useParams()
  const s = useStore(st => st.startups.find(x => x.id === id))
  const trades = useStore(st => st.trades).filter(t => t.startupId === id).slice(0, 8)
  if (!s)
    return (
      <Empty
        title="This startup is not listed"
        body="The link may be old, or the listing was removed."
        action={
          <Link to="/explore" className="btn btn-lime">
            Explore startups
          </Link>
        }
      />
    )
  const p = priceOf(s)
  const passing = Object.values(s.checks).filter(c => c.status === 'passed').length

  return (
    <div>
      <Link to="/explore" className="mb-5 inline-flex items-center gap-1 text-[15px] text-ink2 hover:text-ink">
        <Icon name="right" size={16} style={{ transform: 'rotate(180deg)' }} />
        All startups
      </Link>
      <header className="mb-7 flex flex-wrap items-center gap-5">
        <Coin label={s.ticker} size={84} hover thick tone={coinTone(s)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-[36px] sm:text-[48px]" style={{ fontStretch: '85%' }}>{s.name}</h1>
            <span className="text-[20px] text-ink3">{s.ticker}</span>
            <StatusBadge s={s} />
          </div>
          <p className="mt-1.5 max-w-[64ch] text-[17px] text-ink2">{s.tagline}</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[15px] text-ink2">
            <span className="inline-flex items-center gap-1.5"><Icon name="globe" size={16} />{s.website}</span>
            <span className="inline-flex items-center gap-1.5"><Icon name="code" size={16} />{s.github}</span>
            <span className="inline-flex items-center gap-1.5"><Icon name="at" size={16} />{s.social.replace(/^@/, '')}</span>
            <span className="text-ink3">{s.category}, {s.country}, listed {dateLong(s.listedAt)}</span>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-5">
          <Panel>
            {s.phase === 'live' && (
              <>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="flex items-baseline gap-3">
                      <span className="font-display text-[44px] font-semibold leading-none">{price(p)}</span>
                      <Change value={change24h(s)} className="text-[18px]" />
                    </div>
                    <div className="mt-1.5 text-sm text-ink3">Raise price was {price(s.salePrice)}</div>
                  </div>
                  <dl className="m-0 flex gap-7">
                    {[
                      ['Market cap', usdCompact(mcapOf(s))],
                      ['24h volume', usdCompact(s.volume24h)],
                      ['Liquidity', usdCompact(s.poolUsdc * 2)],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-sm text-ink3">{k}</dt>
                        <dd className="m-0 font-semibold">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="mt-5">
                  <AreaChart data={s.history} height={280} format={price} name={`${s.ticker} price`} labels={i => (i === s.history.length - 1 ? 'Now' : i === 0 ? 'Listing' : 'Trade ' + (i + 1))} />
                </div>
              </>
            )}
            {s.phase === 'raising' && (
              <>
                <h2 className="text-[24px]">Raise in progress</h2>
                <p className="mt-1.5 max-w-[62ch] text-ink2">
                  Everyone buys at the same price. When the raise fills, 80% of the proceeds lock in the treasury, the rest becomes trading liquidity, and the token starts trading.
                </p>
                <dl className="m-0 mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
                  {[
                    ['Fixed price', price(s.salePrice)],
                    ['Target', usd(s.raiseTarget)],
                    ['Committed', usd(s.raised)],
                    ['Tokens on sale', compact(SUPPLY.sale)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-sm text-ink3">{k}</dt>
                      <dd className="m-0 font-display text-[24px] font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {s.phase === 'wound_down' && (
              <>
                <h2 className="text-[24px]">This startup wound down</h2>
                <p className="mt-1.5 max-w-[62ch] text-ink2">
                  The checks failed for {WINDDOWN_DAYS} days in a row{s.woundDownAt ? `, ending ${dateLong(s.woundDownAt)}` : ''}. Trading stopped, the founders&apos; locked tokens were burned, and everything left in the vaults and the pool was set aside for holders.
                </p>
                <dl className="m-0 mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3">
                  {[
                    ['Refund per token', price(s.refundPerToken)],
                    ['Still to be claimed', usd(s.refundPool)],
                    ['Raise price was', price(s.salePrice)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-sm text-ink3">{k}</dt>
                      <dd className="m-0 font-display text-[24px] font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </Panel>

          <div className="lg:hidden">
            <TradePanel s={s} />
          </div>

          <Money s={s} />

          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-[24px]">Verification</h2>
                <p className="mt-1.5 text-ink2">
                  {passing} of 5 checks passing. These re-run on a schedule, not only at listing.
                </p>
              </div>
              <div className="text-right">
                <Beats beats={s.beats} />
                <div className="mt-1.5 text-sm text-ink3">Last passed {ago(s.lastBeat)}</div>
              </div>
            </div>
            <div className="mt-5">
              <Checklist checks={s.checks} />
            </div>
          </Panel>

          <Panel>
            <h2 className="text-[24px]">About {s.name}</h2>
            <p className="mt-3 max-w-[68ch] text-[17px] leading-relaxed text-ink2">{s.about}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {s.founders.map(f => (
                <div key={f.name} className="glass-flat flex items-center gap-3 py-2.5 pl-2.5 pr-4">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-white/[.08] font-display font-semibold">{f.name.replace(/[^A-Za-zÀ-ÿ ]/g, '').split(' ').map(w => w[0]).slice(0, 2).join('')}</span>
                  <span>
                    <span className="block font-semibold leading-tight">{f.name}</span>
                    <span className="block text-sm text-ink2">{f.role}</span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel pad={false}>
            <h2 className="px-5 pt-5 text-[24px] sm:px-7 sm:pt-7">Recent trades</h2>
            {trades.length ? (
              <div className="mt-3 pb-2">
                {trades.map(t => (
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

        <aside className="hidden gap-5 lg:sticky lg:top-[96px] lg:grid">
          <TradePanel s={s} />
          <div className="glass p-6">
            <h2 className="text-[19px]">Token supply</h2>
            <div className="mt-3 text-[15px]">
              {[
                ['Public, raise and liquidity', (SUPPLY.sale + SUPPLY.liquidity) / SUPPLY.total],
                ['Founders, locked', SUPPLY.founders / SUPPLY.total],
                ['Platform, same lock', SUPPLY.platform / SUPPLY.total],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between border-t border-white/[.06] py-2 first:border-t-0">
                  <span className="text-ink2">{k}</span>
                  <span className="font-semibold">{pctPlain(v as number)}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
