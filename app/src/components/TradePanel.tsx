import { useId, useState } from 'react'
import { FEE } from '../config'
import { feeParts, priceOf, quoteBuy, quoteSell } from '../lib/curve'
import { compact, num, pctPlain, price, usd } from '../lib/format'
import { useStore, useUi } from '../store/useStore'
import type { Startup } from '../store/types'
import { Coin } from './Coin'
import { Icon, Progress, cx } from './ui'

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-ink2">{k}</span>
      <span className={cx(strong ? 'font-semibold text-ink' : 'text-ink')}>{v}</span>
    </div>
  )
}

export function TradePanel({ s }: { s: Startup }) {
  const wallet = useStore(st => st.wallet)
  const held = useStore(st => st.holdings[s.id]?.tokens ?? 0)
  const { buy, sell, commit, claimRefund } = useStore.getState()
  const { toast, openConnect } = useUi()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [raw, setRaw] = useState('')
  const [showFees, setShowFees] = useState(false)
  const [busy, setBusy] = useState(false)
  const amount = Math.max(0, parseFloat(raw) || 0)
  const connected = !!wallet.address

  const run = (fn: () => ReturnType<typeof buy>, okTitle: string, okBody?: string) => {
    if (!connected) return openConnect(true)
    setBusy(true)
    // A short pause stands in for the transaction confirming.
    setTimeout(() => {
      const r = fn()
      setBusy(false)
      if (r.ok) {
        toast({ tone: 'ok', title: okTitle, body: r.message && isNaN(Number(r.message)) ? r.message : okBody, coin: s.ticker })
        setRaw('')
      } else toast({ tone: 'error', title: 'That did not go through', body: r.error })
    }, 650)
  }

  if (s.phase === 'wound_down') {
    const due = held * s.refundPerToken
    return (
      <div className="glass p-5 sm:p-6">
        <h2 className="text-[22px]">Claim your refund</h2>
        <p className="mt-2 text-ink2">Trading has stopped. Each token is redeemed for its share of the money that was left.</p>
        <div className="glass-flat mt-5 p-4">
          <Line k="Refund per token" v={price(s.refundPerToken)} />
          <Line k="You hold" v={`${compact(held)} ${s.ticker}`} />
          <Line k="You receive" v={usd(due, 2)} strong />
        </div>
        <button
          className="btn btn-lime mt-5 w-full"
          disabled={busy || (connected && held <= 0)}
          onClick={() => run(() => claimRefund(s.id), `Refunded ${usd(due, 2)}`, `${compact(held)} ${s.ticker} redeemed`)}
        >
          {!connected ? 'Connect wallet' : busy ? 'Confirming' : held > 0 ? `Claim ${usd(due, 2)}` : 'Nothing to claim'}
        </button>
      </div>
    )
  }

  if (s.phase === 'raising') {
    const room = s.raiseTarget - s.raised
    const pay = Math.min(amount, room)
    const tokens = pay / s.salePrice
    return (
      <div className="glass p-5 sm:p-6">
        <h2 className="text-[22px]">Back this raise</h2>
        <div className="mt-4 flex items-baseline justify-between">
          <span className="font-display text-[28px] font-semibold">{usd(s.raised)}</span>
          <span className="text-ink2">of {usd(s.raiseTarget)}</span>
        </div>
        <div className="mt-2">
          <Progress value={s.raised / s.raiseTarget} tone="blue" height={10} />
        </div>
        <div className="mt-2 text-sm text-ink3">
          {pctPlain(s.raised / s.raiseTarget)} committed by {s.backers} backers. Trading opens when the raise fills.
        </div>
        <AmountInput raw={raw} setRaw={setRaw} unit="USDC" balance={wallet.usdc} connected={connected} max={Math.min(wallet.usdc, room)} />
        <div className="glass-flat mt-4 px-4 py-2.5">
          <Line k="Fixed price" v={price(s.salePrice)} />
          <Line k="You receive" v={`${compact(tokens)} ${s.ticker}`} strong />
          <Line k="Goes to the treasury" v="80% after a 2.5% listing fee" />
        </div>
        <button className="btn btn-lime mt-5 w-full" disabled={busy || (connected && pay <= 0)} onClick={() => run(() => commit(s.id, pay), `Committed ${usd(pay, 2)}`, `${compact(tokens)} ${s.ticker} reserved for you`)}>
          {!connected ? 'Connect wallet' : busy ? 'Confirming' : pay > 0 ? `Commit ${usd(pay, 2)}` : 'Enter an amount'}
        </button>
      </div>
    )
  }

  const isBuy = side === 'buy'
  const qb = quoteBuy(s, amount)
  const qs = quoteSell(s, Math.min(amount, Math.max(held, 0)))
  const fee = isBuy ? qb.fee : qs.fee
  const parts = feeParts(fee)
  const impact = isBuy ? qb.impact : qs.impact
  const receive = isBuy ? `${compact(qb.tokensOut)} ${s.ticker}` : usd(qs.usdcOut, 2)
  const tooMuch = isBuy ? amount > wallet.usdc : amount > held + 1e-6
  const label = !connected ? 'Connect wallet' : busy ? 'Confirming' : amount <= 0 ? 'Enter an amount' : tooMuch ? (isBuy ? 'Not enough USDC' : `Not enough ${s.ticker}`) : isBuy ? `Buy ${s.ticker}` : `Sell ${s.ticker}`

  return (
    <div className="glass p-5 sm:p-6">
      <div className="glass-flat grid grid-cols-2 p-1" style={{ borderRadius: 999 }} role="tablist">
        {(['buy', 'sell'] as const).map(k => (
          <button
            key={k}
            role="tab"
            aria-selected={side === k}
            onClick={() => {
              setSide(k)
              setRaw('')
            }}
            className={cx('h-10 rounded-full text-[15px] font-semibold capitalize transition', side === k ? 'bg-white/[.14] text-ink' : 'text-ink2')}
          >
            {k}
          </button>
        ))}
      </div>
      <AmountInput raw={raw} setRaw={setRaw} unit={isBuy ? 'USDC' : s.ticker} balance={isBuy ? wallet.usdc : held} connected={connected} max={isBuy ? wallet.usdc : held} />
      <div className="glass-flat mt-4 px-4 py-2.5">
        <Line k="Price" v={price(priceOf(s))} />
        <Line k="You receive" v={amount > 0 ? receive : '0'} strong />
        <Line k="Price impact" v={amount > 0 ? (impact * 100).toFixed(2) + '%' : '0.00%'} />
        <button className="flex w-full items-baseline justify-between gap-4 py-1.5 text-left" onClick={() => setShowFees(v => !v)} aria-expanded={showFees}>
          <span className="flex items-center gap-1.5 text-ink2">
            Fee, {(FEE.total * 100).toFixed(0)}%
            <Icon name="down" size={14} style={{ transform: showFees ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
          </span>
          <span>{usd(fee, 2)}</span>
        </button>
        {showFees && (
          <div className="swap-in mb-1 border-t border-white/[.07] pt-1 text-sm">
            <Line k="Startup fee vault" v={usd(parts.startup, 2)} />
            <Line k="Holder reserve" v={usd(parts.reserve, 2)} />
            <Line k="Platform" v={usd(parts.platform, 2)} />
            <Line k="Trading infrastructure" v={usd(parts.infra, 2)} />
          </div>
        )}
      </div>
      {s.heartbeat === 'red' && (
        <div className="mt-4 flex gap-2.5 rounded-2xl border border-red/30 bg-red/10 p-3.5 text-sm text-[#ffc2bb]">
          <Icon name="alert" className="mt-0.5" />
          <span>
            This startup has been silent for {s.redDays} days. Payouts to founders are paused. It winds down and refunds at 60.
          </span>
        </div>
      )}
      <button
        className="btn btn-lime mt-5 w-full"
        disabled={busy || (connected && (amount <= 0 || tooMuch))}
        onClick={() =>
          isBuy
            ? run(() => buy(s.id, amount), `Bought ${compact(qb.tokensOut)} ${s.ticker}`, `Paid ${usd(amount, 2)}`)
            : run(() => sell(s.id, amount), `Sold ${compact(amount)} ${s.ticker}`, `Received ${usd(qs.usdcOut, 2)}`)
        }
      >
        {busy && <Coin label={s.ticker} size={22} spin />}
        {label}
      </button>
      {connected && held > 0 && (
        <div className="mt-3 text-center text-sm text-ink3">
          You hold {num(held, 0)} {s.ticker}, worth {usd(held * priceOf(s), 2)}
        </div>
      )}
    </div>
  )
}

function AmountInput({ raw, setRaw, unit, balance, connected, max }: { raw: string; setRaw: (v: string) => void; unit: string; balance: number; connected: boolean; max: number }) {
  const id = useId()
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <label htmlFor={id} className="font-semibold text-ink2">
          Amount
        </label>
        <span className="text-ink3">{connected ? `Balance ${unit === 'USDC' ? usd(balance, 2) : compact(balance) + ' ' + unit}` : 'Wallet not connected'}</span>
      </div>
      <div className="relative">
        <input
          id={id}
          className="input !h-[58px] !pr-20 font-display !text-[24px] font-semibold"
          inputMode="decimal"
          placeholder="0"
          value={raw}
          onChange={e => setRaw(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 font-semibold text-ink2">{unit}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {[0.25, 0.5, 0.75, 1].map(f => (
          <button key={f} className="chip justify-center !px-0" disabled={!connected || max <= 0} onClick={() => setRaw(String(Math.floor(max * f * 100) / 100))}>
            {f === 1 ? 'Max' : f * 100 + '%'}
          </button>
        ))}
      </div>
    </div>
  )
}
