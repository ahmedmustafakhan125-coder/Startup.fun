import { Link } from 'react-router-dom'
import { Beats, Checklist } from '../components/Checklist'
import { Coin } from '../components/Coin'
import { coinTone } from '../components/StartupRow'
import { Empty, Icon, PageHead, Panel, Progress, StatusBadge, cx } from '../components/ui'
import { CLIFF_MONTHS, REVIEW_MAX_DAYS, REVIEW_MIN_DAYS, SUPPLY, VEST_MONTHS, WINDDOWN_DAYS } from '../config'
import { claimableFees, claimableTreasury, founderClaimable, priceOf, runwayMonths, vestedTokens } from '../lib/curve'
import { ago, compact, dateLong, dayMs, pctPlain, price, usd } from '../lib/format'
import { useStore, useUi } from '../store/useStore'
import type { Application, Result, Startup } from '../store/types'

function Timeline({ a }: { a: Application }) {
  const passed = Object.values(a.checks).filter(c => c.status === 'passed').length
  const rejected = a.status === 'rejected'
  const reached = { submitted: 1, in_review: 2, scheduled: 3, listed: 4, rejected: 2 }[a.status]
  const steps = [
    { title: 'Submitted', note: dateLong(a.submittedAt) },
    { title: 'Automated checks', note: `${passed} of 5 passing` },
    { title: rejected ? 'Rejected' : 'Reviewer decision', note: rejected ? dateLong(a.decidedAt ?? Date.now()) : a.decidedAt ? 'Approved ' + dateLong(a.decidedAt) : `Due by ${dateLong(a.submittedAt + REVIEW_MAX_DAYS * dayMs)}` },
    { title: 'Listing date', note: a.scheduledFor ? dateLong(a.scheduledFor) : 'Set after approval' },
    { title: 'Raise opens', note: a.status === 'listed' ? 'Open now' : 'After listing' },
  ]
  return (
    <ol className="m-0 mt-5 grid list-none gap-3 p-0 sm:grid-cols-5">
      {steps.map((st, i) => {
        const done = i < reached || a.status === 'listed'
        const now = i === reached && a.status !== 'listed'
        const bad = rejected && i === 2
        return (
          <li key={st.title} className="flex gap-3 sm:block">
            <div className="flex items-center gap-2 sm:mb-2.5">
              <span
                className={cx('grid h-7 w-7 flex-none place-items-center rounded-full text-[13px] font-bold', bad ? 'bg-red text-black' : done ? 'bg-lime text-black' : now ? 'border border-lime/70 text-lime' : 'bg-white/[.08] text-ink3')}
              >
                {bad ? <Icon name="x" size={14} /> : done ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <span className={cx('hidden h-[2px] flex-1 rounded sm:block', i === steps.length - 1 && 'sm:hidden', done ? 'bg-lime/60' : 'bg-white/10')} />
            </div>
            <div>
              <div className={cx('font-semibold leading-snug', !done && !now && 'text-ink2')}>{st.title}</div>
              <div className="text-sm text-ink3">{st.note}</div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function ClaimTile({ icon, title, amount, note, action, disabled, onClaim }: { icon: string; title: string; amount: string; note: string; action: string; disabled: boolean; onClaim: () => void }) {
  return (
    <div className="glass-flat flex flex-col p-5">
      <div className="flex items-center gap-2.5 text-ink2">
        <Icon name={icon} />
        <span className="font-semibold">{title}</span>
      </div>
      <div className="mt-3 font-display text-[30px] font-semibold leading-none">{amount}</div>
      <p className="mb-4 mt-2.5 flex-1 text-[15px] text-ink2">{note}</p>
      <button className="btn btn-lime btn-sm" disabled={disabled} onClick={onClaim}>
        {action}
      </button>
    </div>
  )
}

function MyStartup({ s }: { s: Startup }) {
  const { founderClaimTreasury, founderClaimFees, founderClaimTokens } = useStore.getState()
  const month = useStore(st => st.month)
  const toast = useUi(u => u.toast)
  const red = s.heartbeat === 'red'
  const t = claimableTreasury(s)
  const f = claimableFees(s)
  const tok = founderClaimable(s)
  const toCliff = Math.max(0, CLIFF_MONTHS - s.vestMonths)
  const act = (r: Result, title: (m: string) => string) =>
    r.ok ? toast({ tone: 'ok', title: title(r.message ?? ''), coin: s.ticker }) : toast({ tone: 'error', title: 'Nothing was claimed', body: r.error })

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-4">
        <Coin label={s.ticker} size={56} hover tone={coinTone(s)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[26px]">{s.name}</h2>
            <StatusBadge s={s} />
          </div>
          <div className="text-ink2">
            {s.phase === 'live' ? `Trading at ${price(priceOf(s))}, month ${s.vestMonths} since listing` : s.phase === 'raising' ? 'Raise open' : 'Wound down'}
          </div>
        </div>
        <Link to={`/s/${s.id}`} className="btn btn-glass btn-sm">
          View public page
        </Link>
      </div>

      {s.phase === 'raising' && (
        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-[28px] font-semibold">{usd(s.raised)}</span>
            <span className="text-ink2">of {usd(s.raiseTarget)}</span>
          </div>
          <div className="mt-2">
            <Progress value={s.raised / s.raiseTarget} tone="blue" height={10} />
          </div>
          <p className="mt-3 text-ink2">
            {pctPlain(s.raised / s.raiseTarget)} committed by {s.backers} backers. When it fills, 80% locks in your treasury and trading opens. Nothing is claimable before that.
          </p>
        </div>
      )}

      {s.phase === 'live' && (
        <>
          {red && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-red/30 bg-red/10 p-4 text-[15px] text-[#ffc2bb]">
              <Icon name="alert" className="mt-0.5" />
              <p className="m-0">
                Your checks have failed for {s.redDays} days, so every payout is paused. Fix the failing checks below. At {WINDDOWN_DAYS} days the startup winds down and holders are refunded.
              </p>
            </div>
          )}
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <ClaimTile
              icon="vault"
              title="Treasury, this month"
              amount={usd(t)}
              note={`Budget ${usd(s.monthlyBudget)} a month. ${usd(s.treasury)} left, about ${runwayMonths(s).toFixed(1)} months.`}
              action={t > 0 ? `Claim ${usd(t)}` : red ? 'Paused' : 'Claimed for this month'}
              disabled={t <= 0}
              onClaim={() => act(founderClaimTreasury(s.id), m => `Claimed ${usd(Number(m), 2)} from the treasury`)}
            />
            <ClaimTile
              icon="chart"
              title="Trading fees"
              amount={usd(f, 2)}
              note={`Vault holds ${usd(s.feeVault, 2)}. Your cap is ${usd(s.feeCap)} a month, ${usd(s.feesClaimedThisMonth, 2)} taken so far.`}
              action={f > 0 ? `Claim ${usd(f, 2)}` : red ? 'Paused' : 'Nothing to claim'}
              disabled={f <= 0}
              onClaim={() => act(founderClaimFees(s.id), m => `Claimed ${usd(Number(m), 2)} in fees`)}
            />
            <ClaimTile
              icon="lock"
              title="Your tokens"
              amount={compact(tok)}
              note={
                toCliff > 0
                  ? `Locked for ${toCliff} more ${toCliff === 1 ? 'month' : 'months'}. Then ${compact(SUPPLY.founders / VEST_MONTHS)} unlock each month.`
                  : `${compact(vestedTokens(s))} of ${compact(SUPPLY.founders)} unlocked, ${compact(s.founderClaimed)} claimed.`
              }
              action={tok > 0 ? `Claim ${compact(tok)} ${s.ticker}` : toCliff > 0 ? 'Locked' : red ? 'Paused' : 'Nothing unlocked'}
              disabled={tok <= 0}
              onClaim={() => act(founderClaimTokens(s.id), m => `Claimed ${compact(Number(m))} ${s.ticker}`)}
            />
          </div>
          <div className="mt-6 grid gap-6 border-t border-white/[.07] pt-6 lg:grid-cols-[1fr_260px]">
            <div>
              <h3 className="mb-4 text-[19px]">Your heartbeat checks</h3>
              <Checklist checks={s.checks} />
            </div>
            <div className="glass-flat h-fit p-5">
              <div className="text-sm text-ink3">Last 14 heartbeats</div>
              <div className="mt-3">
                <Beats beats={s.beats} />
              </div>
              <div className="mt-3 text-[15px] text-ink2">Last passed {ago(s.lastBeat)}.</div>
              <div className="mt-1 text-sm text-ink3">Demo clock is at month {month}. Advance it from Admin.</div>
            </div>
          </div>
        </>
      )}

      {s.phase === 'wound_down' && <p className="mt-5 text-ink2">This startup wound down. The remaining funds were set aside for holders and the locked founder tokens were burned.</p>}
    </Panel>
  )
}

export default function FounderDashboard() {
  const wallet = useStore(s => s.wallet)
  const apps = useStore(s => s.applications).filter(a => a.mine)
  const mine = useStore(s => s.startups).filter(s => s.mine)
  const openConnect = useUi(u => u.openConnect)

  if (!wallet.address)
    return (
      <div>
        <PageHead title="Founder" />
        <Empty
          title="Connect the wallet you listed with"
          body="Your applications, payouts and heartbeat checks are tied to that wallet."
          action={
            <button className="btn btn-lime" onClick={() => openConnect(true)}>
              Connect wallet
            </button>
          }
        />
      </div>
    )

  const open = apps.filter(a => a.status !== 'listed')
  return (
    <div>
      <PageHead
        title="Founder"
        lead="Claim what has been released, and keep your checks passing so it keeps releasing."
        right={
          <Link to="/list" className="btn btn-glass">
            List another startup
          </Link>
        }
      />
      <div className="grid gap-5">
        {open.map(a => (
          <Panel key={a.id}>
            <div className="flex flex-wrap items-center gap-4">
              <Coin label={a.ticker} size={52} tone={a.status === 'rejected' ? 'dim' : 'lime'} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[24px]">{a.name}</h2>
                <div className="text-ink2">Application, {ago(a.submittedAt)}</div>
              </div>
              <span className={cx('badge', a.status === 'rejected' ? 'badge-red' : a.status === 'scheduled' ? 'badge-green' : 'badge-amber')}>
                {a.status === 'rejected' ? 'Rejected' : a.status === 'scheduled' ? 'Approved and scheduled' : 'In review'}
              </span>
            </div>
            <Timeline a={a} />
            {a.status === 'rejected' ? (
              <p className="mt-5 rounded-2xl border border-red/30 bg-red/10 p-4 text-[15px] text-[#ffc2bb]">Reviewer note: {a.rejectionReason}</p>
            ) : (
              <p className="mt-5 text-[15px] text-ink2">
                Reviews take {REVIEW_MIN_DAYS} to {REVIEW_MAX_DAYS} days from submission. You do not need to do anything unless a check fails.
              </p>
            )}
          </Panel>
        ))}
        {mine.map(s => (
          <MyStartup key={s.id} s={s} />
        ))}
        {!open.length && !mine.length && (
          <Empty
            title="You have not listed a startup yet"
            body="Apply in five steps. Once a reviewer approves it, your raise opens here."
            action={
              <Link to="/list" className="btn btn-lime">
                List your startup
              </Link>
            }
          />
        )}
      </div>
    </div>
  )
}
