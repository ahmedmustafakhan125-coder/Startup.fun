import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, SplitBar } from '../components/Charts'
import { Coin } from '../components/Coin'
import { Globe, groupByCountry } from '../components/Globe'
import { Change, StartupRow, coinTone } from '../components/StartupRow'
import { Icon, Panel, Progress, StatusBadge, cx } from '../components/ui'
import { FEE, REVIEW_MAX_DAYS, REVIEW_MIN_DAYS, WINDDOWN_DAYS } from '../config'
import { change24h, mcapOf, priceOf } from '../lib/curve'
import { pctPlain, price, usdCompact } from '../lib/format'
import { useStore } from '../store/useStore'

const outcomes = {
  alive: [
    ['Raise treasury', 'Releases this month’s budget to the founders'],
    ['Trading fees', 'Founders claim up to their monthly cap'],
    ['Founder tokens', 'Keep unlocking after the 12-month lock'],
  ],
  silent: [
    ['Raise treasury', 'Unspent balance is refunded to holders'],
    ['Trading fees', 'Fee vault and holder reserve are refunded'],
    ['Founder tokens', 'Locked tokens are burned'],
  ],
}

function HeroCoin({ rotation, tossKey, size }: { rotation: number; tossKey: number; size: number }) {
  const faces = {
    front: (
      <span>
        Alive
        <span className="coin-sub">checks passing</span>
      </span>
    ),
    back: (
      <span>
        Silent
        <span className="coin-sub">{WINDDOWN_DAYS} days</span>
      </span>
    ),
  }
  return (
    <div className="hero-coin flex flex-col items-center" style={{ height: size * 1.52 }}>
      <div key={tossKey} className="toss">
        <Coin label="" size={size} thick rotation={rotation} front={faces.front} back={faces.back} />
      </div>
      <div className="coin-reflection" style={{ marginTop: size * 0.06 }} aria-hidden="true">
        <Coin label="" size={size} thick rotation={rotation} front={faces.front} back={faces.back} />
      </div>
    </div>
  )
}

export default function Home() {
  const startups = useStore(s => s.startups)
  const [rotation, setRotation] = useState(-720)
  const [tossKey, setTossKey] = useState(0)
  const [size, setSize] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 190 : 270))
  const side: 'alive' | 'silent' = Math.abs(rotation / 180) % 2 === 0 ? 'alive' : 'silent'

  // One toss on load, then the coin waits for the visitor.
  useEffect(() => {
    const t = setTimeout(() => setRotation(0), 250)
    const onResize = () => setSize(window.innerWidth < 640 ? 190 : 270)
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  const flip = (to?: 'alive' | 'silent') => {
    if (to && to === side) return
    setRotation(r => r + 540)
    setTossKey(k => k + 1)
  }

  const groups = useMemo(() => groupByCountry(startups), [startups])
  const [focus, setFocus] = useState<string | null>(null)
  const focused = groups.find(g => g.name === focus)

  const live = useMemo(() => startups.filter(s => s.phase === 'live').sort((a, b) => b.volume24h - a.volume24h), [startups])
  const raising = startups.filter(s => s.phase === 'raising')
  const lead = live[0]
  const escrow = startups.reduce((a, s) => a + s.treasury + s.feeVault + s.holderReserve, 0)
  const vol = startups.reduce((a, s) => a + s.volume24h, 0)
  const refunded = startups.filter(s => s.phase === 'wound_down').reduce((a, s) => a + s.refundPerToken * (s.circulating || 0), 0)

  return (
    <div>
      {/* Hero */}
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.15fr_.85fr] lg:pt-10">
        <div>
          <h1 className="rise text-[46px] font-semibold leading-[.98] sm:text-[68px] lg:text-[80px]" style={{ fontStretch: '78%', letterSpacing: '-0.035em' }}>
            Back startups that have to prove they are still building, every month.
          </h1>
          <p className="rise mt-6 max-w-[54ch] text-[18px] text-ink2" style={{ '--d': '.12s' } as CSSProperties}>
            Founders list a verified startup and raise into escrow. The money releases month by month while their checks keep passing. If they go silent for {WINDDOWN_DAYS} days, what is left goes back to token holders.
          </p>
          <div className="rise mt-8 flex flex-wrap gap-3" style={{ '--d': '.2s' } as CSSProperties}>
            <Link to="/explore" className="btn btn-lime">
              Explore startups
            </Link>
            <Link to="/list" className="btn btn-glass">
              List your startup
            </Link>
          </div>
        </div>
        <div className="rise flex flex-col items-center" style={{ '--d': '.1s' } as CSSProperties}>
          <button onClick={() => flip()} className="rounded-full" aria-label={`Flip the coin. Showing: ${side === 'alive' ? 'startup alive' : 'startup silent'}`}>
            <HeroCoin rotation={rotation} tossKey={tossKey} size={size} />
          </button>
        </div>
      </section>

      {/* The two sides of every token */}
      <Panel className="rise mt-6" style={{ '--d': '.28s' } as CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-[24px] sm:text-[28px]">Every token has two sides. Flip it.</h2>
          <div className="glass-flat flex p-1" style={{ borderRadius: 999 }} role="tablist" aria-label="Outcome">
            {(['alive', 'silent'] as const).map(k => (
              <button key={k} role="tab" aria-selected={side === k} onClick={() => flip(k)} className={cx('h-10 rounded-full px-5 text-[15px] font-semibold transition', side === k ? (k === 'alive' ? 'bg-lime text-black' : 'bg-blue text-white') : 'text-ink2')}>
                {k === 'alive' ? 'Still building' : `Silent ${WINDDOWN_DAYS} days`}
              </button>
            ))}
          </div>
        </div>
        <div key={side} className="swap-in mt-6 grid gap-3 md:grid-cols-3">
          {outcomes[side].map(([k, v]) => (
            <div key={k} className="glass-flat p-5">
              <div className="text-sm text-ink3">{k}</div>
              <div className="mt-1.5 text-[18px] font-semibold leading-snug">{v}</div>
            </div>
          ))}
        </div>
        <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/[.07] pt-6 md:grid-cols-4">
          {[
            ['Held in escrow now', usdCompact(escrow)],
            ['Traded in 24 hours', usdCompact(vol)],
            ['Startups listed', String(startups.length)],
            ['Refunded to holders', usdCompact(refunded)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm text-ink3">{k}</dt>
              <dd className="m-0 mt-1 font-display text-[28px] font-semibold leading-none">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {/* Where they are building */}
      <section className="mt-20">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[30px] sm:text-[38px]" style={{ fontStretch: '85%' }}>Where they are building</h2>
            <p className="mt-2 max-w-[56ch] text-ink2">
              {startups.length} startups from {groups.length} countries. Drag the globe, or pick a country to fly there.
            </p>
          </div>
        </div>
        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
          <Globe groups={groups} focus={focus} onSelect={setFocus} />
          <div className="glass overflow-hidden">
            <ul className="m-0 list-none p-0" aria-label="Countries">
              {groups.map(g => {
                const on = focus === g.name
                return (
                  <li key={g.name} className="row-line first:border-t-0">
                    <button className={cx('flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition hover:bg-white/[.04]', on && 'bg-white/[.06]')} aria-expanded={on} onClick={() => setFocus(on ? null : g.name)}>
                      <span className={cx('grid h-9 w-9 flex-none place-items-center rounded-full text-[13px] font-bold', g.alive ? 'bg-lime/15 text-lime' : 'bg-white/10 text-ink2')}>{g.code}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{g.name}</span>
                        <span className="block truncate text-sm text-ink3">{g.startups.map(s => s.name).join(', ')}</span>
                      </span>
                      <span className="flex -space-x-2">
                        {g.startups.slice(0, 3).map(s => (
                          <Coin key={s.id} label={s.ticker} size={28} tone={coinTone(s)} />
                        ))}
                      </span>
                    </button>
                    {on && focused && (
                      <div className="swap-in grid gap-2 px-5 pb-4">
                        {focused.startups.map(s => (
                          <Link key={s.id} to={`/s/${s.id}`} className="coin-host glass-flat flex items-center gap-3 p-3 transition hover:bg-white/[.07]">
                            <Coin label={s.ticker} size={38} hover tone={coinTone(s)} />
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">{s.name}</span>
                              <span className="block truncate text-sm text-ink2">{s.tagline}</span>
                            </span>
                            <span className="hidden text-right sm:block">
                              <span className="block font-semibold">{price(priceOf(s))}</span>
                              <StatusBadge s={s} compact />
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </section>

      {/* Trading now */}
      <section className="mt-20">
        <div className="mb-5 flex items-end justify-between gap-4">
          <h2 className="text-[30px] sm:text-[38px]" style={{ fontStretch: '85%' }}>Trading now</h2>
          <Link to="/explore" className="btn btn-glass btn-sm">
            See all {startups.length}
          </Link>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          {lead && (
            <Link to={`/s/${lead.id}`} className="coin-host glass mirror block p-5 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <Coin label={lead.ticker} size={60} hover />
                  <div>
                    <div className="font-display text-[26px] font-semibold leading-tight">{lead.name}</div>
                    <div className="text-ink2">{lead.category}</div>
                  </div>
                </div>
                <StatusBadge s={lead} compact />
              </div>
              <p className="mt-4 max-w-[52ch] text-ink2">{lead.tagline}</p>
              <div className="mt-5 flex items-baseline gap-3">
                <span className="font-display text-[34px] font-semibold leading-none">{price(priceOf(lead))}</span>
                <Change value={change24h(lead)} />
                <span className="text-sm text-ink3">market cap {usdCompact(mcapOf(lead))}</span>
              </div>
              <div className="mt-3" onClick={e => e.preventDefault()}>
                <AreaChart data={lead.history} height={170} format={price} name={`${lead.ticker} price`} />
              </div>
            </Link>
          )}
          <div className="glass overflow-hidden">
            {live.slice(1, 5).map(s => (
              <StartupRow key={s.id} s={s} dense />
            ))}
          </div>
        </div>
      </section>

      {/* Open raises */}
      {raising.length > 0 && (
        <section className="mt-20">
          <h2 className="mb-5 text-[30px] sm:text-[38px]" style={{ fontStretch: '85%' }}>Open raises</h2>
          <div className="grid gap-5 md:grid-cols-2">
            {raising.map(s => (
              <Link key={s.id} to={`/s/${s.id}`} className="coin-host glass block min-w-0 p-5 sm:p-7">
                <div className="flex items-center gap-4">
                  <Coin label={s.ticker} size={52} hover />
                  <div className="min-w-0">
                    <div className="font-display text-[22px] font-semibold leading-tight">{s.name}</div>
                    <div className="truncate text-ink2">{s.tagline}</div>
                  </div>
                </div>
                <div className="mt-6 flex items-baseline justify-between">
                  <span className="font-display text-[26px] font-semibold">{usdCompact(s.raised)}</span>
                  <span className="text-ink2">of {usdCompact(s.raiseTarget)}</span>
                </div>
                <div className="mt-2">
                  <Progress value={s.raised / s.raiseTarget} tone="blue" height={10} />
                </div>
                <div className="mt-3 flex justify-between text-sm text-ink3">
                  <span>{pctPlain(s.raised / s.raiseTarget)} committed by {s.backers} backers</span>
                  <span>{price(s.salePrice)} per token</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* The path */}
      <section className="mt-20">
        <h2 className="mb-5 text-[30px] sm:text-[38px]" style={{ fontStretch: '85%' }}>From application to trading</h2>
        <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-4">
          {[
            ['shield', 'Apply and verify', 'Founders pass identity checks and prove they control the domain, the code and the social accounts.'],
            ['calendar', `Review, ${REVIEW_MIN_DAYS} to ${REVIEW_MAX_DAYS} days`, 'A reviewer reads the application and the automated results, then schedules or rejects the listing.'],
            ['vault', 'Raise into escrow', 'Backers buy at one fixed price. 80% of proceeds lock in the treasury and 20% becomes trading liquidity.'],
            ['pulse', 'Trade, with a heartbeat', 'The same checks keep re-running. Passing keeps the money flowing. Silence pauses it, then refunds it.'],
          ].map(([icon, title, body], i) => (
            <li key={title} className="glass-flat p-5">
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white/[.07] text-lime">
                  <Icon name={icon} size={20} />
                </span>
                <span className="font-display text-[34px] font-semibold leading-none text-white/15">{i + 1}</span>
              </div>
              <h3 className="mt-4 text-[19px]">{title}</h3>
              <p className="mt-2 text-[15px] text-ink2">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Fee split */}
      <section className="mt-20 grid items-start gap-8 lg:grid-cols-[.8fr_1.2fr]">
        <div>
          <h2 className="text-[30px] sm:text-[38px]" style={{ fontStretch: '85%' }}>Where the 1% on each trade goes</h2>
          <p className="mt-4 max-w-[46ch] text-ink2">
            The startup&apos;s share is not a blank cheque. It collects in a vault and pays out only up to a monthly cap, and only while the heartbeat is passing.
          </p>
        </div>
        <Panel>
          <SplitBar
            format={n => (n * 100).toFixed(2) + '%'}
            segments={[
              { label: 'Platform', value: FEE.platform, note: 'Runs reviews and the heartbeat checks' },
              { label: 'Startup fee vault', value: FEE.startup, note: 'Capped each month, paused when silent' },
              { label: 'Holder reserve', value: FEE.reserve, note: 'Paid to holders if the startup winds down' },
              { label: 'Trading infrastructure', value: FEE.infra, note: 'Protocol share of the liquidity pool' },
            ]}
          />
        </Panel>
      </section>
    </div>
  )
}
