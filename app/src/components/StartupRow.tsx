import { Link } from 'react-router-dom'
import { change24h, mcapOf, priceOf } from '../lib/curve'
import { pct, pctPlain, price, usdCompact } from '../lib/format'
import type { Startup } from '../store/types'
import { Sparkline } from './Charts'
import { Coin } from './Coin'
import { Progress, StatusBadge, cx } from './ui'

export function Change({ value, className }: { value: number; className?: string }) {
  const flat = Math.abs(value) < 0.0005
  return (
    <span className={cx('font-semibold', flat ? 'text-ink3' : value > 0 ? 'text-lime' : 'text-red', className)}>
      {flat ? '0.0%' : pct(value)}
    </span>
  )
}

export const coinTone = (s: Startup) => (s.phase === 'wound_down' ? 'dim' : 'lime') as 'dim' | 'lime'

export function StartupRow({ s, dense }: { s: Startup; dense?: boolean }) {
  const raising = s.phase === 'raising'
  const dead = s.phase === 'wound_down'
  return (
    <Link to={`/s/${s.id}`} className="coin-host row-line grid items-center gap-x-4 px-4 py-4 transition first:border-t-0 hover:bg-white/[.035] sm:px-6" style={{ gridTemplateColumns: dense ? 'minmax(0,1fr) auto' : undefined }} data-row={dense ? 'dense' : 'full'}>
      <div className="flex min-w-0 items-center gap-3.5">
        <Coin label={s.ticker} size={dense ? 40 : 46} hover tone={coinTone(s)} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-[18px] font-semibold">{s.name}</span>
            <span className="text-sm text-ink3">{s.ticker}</span>
          </div>
          <div className={cx('truncate text-sm text-ink2', dense && 'hidden')}>{s.tagline}</div>
          <div className={cx('mt-1', !dense && 'lg:hidden')}>
            <StatusBadge s={s} compact />
          </div>
        </div>
      </div>
      {!dense && (
        <div className="hidden lg:block">
          <StatusBadge s={s} compact />
        </div>
      )}
      {!dense && <div className="hidden md:block">{raising ? <div className="w-24"><Progress value={s.raised / s.raiseTarget} tone="blue" /></div> : <Sparkline data={s.history.slice(-40)} />}</div>}
      <div className="text-right">
        <div className="font-semibold">{price(priceOf(s))}</div>
        <div className="text-sm">
          {raising ? <span className="text-ink3">{pctPlain(s.raised / s.raiseTarget)} raised</span> : dead ? <span className="text-ink3">refund per token</span> : <Change value={change24h(s)} />}
        </div>
      </div>
      {!dense && (
        <>
          <div className="hidden text-right md:block">
            <div className="font-semibold">{raising ? usdCompact(s.raiseTarget) : usdCompact(mcapOf(s))}</div>
            <div className="text-sm text-ink3">{raising ? 'target' : 'market cap'}</div>
          </div>
          <div className="hidden text-right lg:block">
            <div className="font-semibold">{raising ? s.backers : usdCompact(s.volume24h)}</div>
            <div className="text-sm text-ink3">{raising ? 'backers' : '24h volume'}</div>
          </div>
        </>
      )}
    </Link>
  )
}
