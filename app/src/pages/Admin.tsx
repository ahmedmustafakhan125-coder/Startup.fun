import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AreaChart, BarChart, SplitBar } from '../components/Charts'
import { CheckDots, Checklist } from '../components/Checklist'
import { Coin } from '../components/Coin'
import { coinTone } from '../components/StartupRow'
import { Icon, Modal, PageHead, Panel, StatusBadge, cx } from '../components/ui'
import { REVIEW_MAX_DAYS, REVIEW_MIN_DAYS, WINDDOWN_DAYS } from '../config'
import { ago, compact, dateLabel, dateLong, dayMs, daysBetween, isoDay, shortAddr, usd, usdCompact } from '../lib/format'
import { useStore, useUi } from '../store/useStore'
import type { Application } from '../store/types'

const statusBadge = (a: Application) =>
  ({
    submitted: ['badge-amber', 'New'],
    in_review: ['badge-amber', 'In review'],
    scheduled: ['badge-green', 'Scheduled'],
    rejected: ['badge-red', 'Rejected'],
    listed: ['badge-blue', 'Listed'],
  })[a.status]

function Due({ a }: { a: Application }) {
  if (a.status === 'scheduled') return <span className="text-ink2">Lists {dateLabel(a.scheduledFor ?? Date.now())}</span>
  if (a.status === 'rejected' || a.status === 'listed') return <span className="text-ink3">Closed {dateLabel(a.decidedAt ?? a.submittedAt)}</span>
  const left = daysBetween(Date.now(), a.submittedAt + REVIEW_MAX_DAYS * dayMs)
  if (left < 0) return <span className="font-semibold text-red">Overdue by {-left} days</span>
  return <span className={cx(left <= 3 ? 'font-semibold text-amber' : 'text-ink2')}>Due in {left} {left === 1 ? 'day' : 'days'}</span>
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'warn' }) {
  return (
    <div className="glass-flat p-5">
      <div className="text-sm text-ink3">{label}</div>
      <div className={cx('mt-1.5 font-display text-[30px] font-semibold leading-none', tone === 'warn' && 'text-amber')}>{value}</div>
      <div className="mt-2 text-sm text-ink2">{sub}</div>
    </div>
  )
}

export default function Admin() {
  const { startups, applications, daily, trades, month } = useStore()
  const { adminRunChecks, adminSchedule, adminReject, adminListNow, adminCloseRaise, adminSetHeartbeat, adminAdvanceMonth, resetDemo } = useStore.getState()
  const toast = useUi(u => u.toast)
  const nav = useNavigate()
  const [range, setRange] = useState(30)
  const [tab, setTab] = useState<'waiting' | 'scheduled' | 'closed'>('waiting')
  const [openId, setOpenId] = useState<string | null>(null)
  const [when, setWhen] = useState('')
  const [reason, setReason] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  const days = daily.slice(-range)
  const sum = (k: 'volume' | 'trading' | 'verification' | 'graduation') => days.reduce((a, d) => a + d[k], 0)
  const revenue = sum('trading') + sum('verification') + sum('graduation')
  const today = daily[daily.length - 1]
  const yesterday = daily[daily.length - 2]
  const escrow = startups.reduce((a, s) => a + s.treasury + s.feeVault + s.holderReserve, 0)
  const live = startups.filter(s => s.phase === 'live')
  const silent = live.filter(s => s.heartbeat === 'red')
  const waiting = applications.filter(a => a.status === 'submitted' || a.status === 'in_review')
  const oldest = waiting.reduce((m, a) => Math.max(m, daysBetween(a.submittedAt, Date.now())), 0)
  const lists = useMemo(
    () => ({
      waiting: [...waiting].sort((a, b) => a.submittedAt - b.submittedAt),
      scheduled: applications.filter(a => a.status === 'scheduled'),
      closed: applications.filter(a => a.status === 'rejected' || a.status === 'listed'),
    }),
    [applications],
  )
  const app = applications.find(a => a.id === openId)
  const allPass = app ? Object.values(app.checks).every(c => c.status === 'passed') : false

  const open = (a: Application) => {
    setOpenId(a.id)
    setReason('')
    setWhen(isoDay(a.scheduledFor ?? Math.max(Date.now() + dayMs, a.submittedAt + REVIEW_MIN_DAYS * dayMs)))
  }
  const advance = () => {
    const wound = adminAdvanceMonth()
    toast(
      wound.length
        ? { tone: 'info', title: `Month ${month + 1}: ${wound.join(', ')} wound down`, body: `Silent for ${WINDDOWN_DAYS} days. Holders can now claim refunds.` }
        : { tone: 'ok', title: `Now in month ${month + 1}`, body: 'Budgets and fee caps reset for startups that are passing.' },
    )
  }

  return (
    <div>
      <PageHead
        title="Admin"
        lead="Platform numbers, the review queue and the heartbeat monitor. On devnet this page is open to everyone. In production it is limited to the admin wallet."
        right={
          <div className="glass-flat flex p-1" style={{ borderRadius: 999 }} role="group" aria-label="Date range">
            {[7, 30].map(r => (
              <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={cx('h-9 rounded-full px-4 text-sm font-semibold transition', range === r ? 'bg-white/[.14] text-ink' : 'text-ink2')}>
                {r} days
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label={`Revenue, ${range} days`} value={usdCompact(revenue)} sub={`${usd(today.trading + today.verification + today.graduation)} today`} />
        <Kpi label="Volume today" value={usdCompact(today.volume)} sub={yesterday ? `${usdCompact(yesterday.volume)} yesterday` : 'First day'} />
        <Kpi label="Held in escrow" value={usdCompact(escrow)} sub="Treasuries, fee vaults, reserves" />
        <Kpi label="Startups" value={String(startups.length)} sub={`${live.length} trading, ${startups.filter(s => s.phase === 'raising').length} raising`} />
        <Kpi label="Review queue" value={String(waiting.length)} sub={waiting.length ? `Oldest waiting ${oldest} days` : 'Nothing waiting'} tone={oldest >= REVIEW_MAX_DAYS - 3 ? 'warn' : undefined} />
        <Kpi label="Silent heartbeats" value={String(silent.length)} sub={silent.length ? silent.map(s => `${s.ticker} ${s.redDays}d`).join(', ') : 'All passing'} tone={silent.length ? 'warn' : undefined} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel>
          <h2 className="text-[20px]">Daily trading volume</h2>
          <p className="mb-4 text-sm text-ink3">{usdCompact(sum('volume'))} over {range} days</p>
          <BarChart data={days.map(d => ({ label: dateLabel(new Date(d.date).getTime()), value: d.volume }))} format={usdCompact} name="Trading volume" />
        </Panel>
        <Panel>
          <h2 className="text-[20px]">Daily platform revenue</h2>
          <p className="mb-4 text-sm text-ink3">{usd(revenue)} over {range} days</p>
          <AreaChart data={days.map(d => d.trading + d.verification + d.graduation)} labels={i => dateLabel(new Date(days[i].date).getTime())} height={220} format={usdCompact} name="Revenue" />
        </Panel>
      </div>

      <Panel className="mt-5">
        <h2 className="mb-4 text-[20px]">Revenue by source, {range} days</h2>
        <SplitBar
          format={n => usd(n)}
          segments={[
            { label: 'Trading fees', value: sum('trading'), note: '0.30% of every trade' },
            { label: 'Listing fees', value: sum('graduation'), note: '2.5% of each raise that closes' },
            { label: 'Verification fees', value: sum('verification'), note: '$300 per application' },
          ]}
        />
      </Panel>

      {/* Review queue */}
      <div className="mb-4 mt-12 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[28px]">Review queue</h2>
          <p className="mt-1 text-ink2">Founders are promised an answer in {REVIEW_MIN_DAYS} to {REVIEW_MAX_DAYS} days.</p>
        </div>
        <div className="flex gap-2">
          {(['waiting', 'scheduled', 'closed'] as const).map(k => (
            <button key={k} className="chip capitalize" data-on={tab === k} onClick={() => setTab(k)}>
              {k}
              <span className="text-ink3">{lists[k].length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="glass overflow-hidden">
        {lists[tab].length === 0 && <p className="m-0 px-6 py-8 text-ink2">Nothing here right now.</p>}
        {lists[tab].map(a => {
          const [cls, word] = statusBadge(a)
          return (
            <div key={a.id} className="row-line grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 px-4 py-4 first:border-t-0 sm:px-6 lg:grid-cols-[minmax(0,1.5fr)_130px_150px_130px_100px_auto]">
              <div className="flex min-w-0 items-center gap-3.5">
                <Coin label={a.ticker} size={44} tone={a.status === 'rejected' ? 'dim' : 'lime'} />
                <div className="min-w-0">
                  <div className="truncate font-display text-[18px] font-semibold">
                    {a.name} {a.mine && <span className="badge badge-blue ml-1 align-middle">Yours</span>}
                  </div>
                  <div className="truncate text-sm text-ink2">
                    {a.founderName}, {a.country}
                  </div>
                </div>
              </div>
              <div className="hidden text-[15px] lg:block">
                <div>{ago(a.submittedAt)}</div>
                <div className="text-sm text-ink3">{dateLabel(a.submittedAt)}</div>
              </div>
              <div className="hidden text-[15px] lg:block">
                <Due a={a} />
              </div>
              <div className="hidden lg:block">
                <CheckDots checks={a.checks} />
              </div>
              <div className="hidden lg:block">
                <span className={cx('badge', cls)}>{word}</span>
              </div>
              <button className="btn btn-glass btn-sm" onClick={() => open(a)}>
                Review
              </button>
              <div className="col-span-2 flex flex-wrap items-center gap-3 text-sm lg:hidden">
                <span className={cx('badge', cls)}>{word}</span>
                <Due a={a} />
                <CheckDots checks={a.checks} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Heartbeat monitor */}
      <div className="mb-4 mt-12 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[28px]">Listings and heartbeats</h2>
          <p className="mt-1 max-w-[70ch] text-ink2">
            The backend will set these from real checks. Here you set them by hand to see what happens. A startup that stays silent through two month advances winds down.
          </p>
        </div>
        <div className="glass-flat flex items-center gap-4 py-2 pl-5 pr-2" style={{ borderRadius: 999 }}>
          <span className="text-[15px]">
            Demo clock: <strong>month {month}</strong>
          </span>
          <button className="btn btn-lime btn-sm" onClick={advance}>
            Advance one month
          </button>
        </div>
      </div>
      <div className="glass overflow-hidden">
        {startups.map(s => (
          <div key={s.id} className="row-line grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 px-4 py-3.5 first:border-t-0 sm:px-6 md:grid-cols-[minmax(0,1.3fr)_190px_1fr_auto]">
            <Link to={`/s/${s.id}`} className="coin-host flex min-w-0 items-center gap-3.5">
              <Coin label={s.ticker} size={40} hover tone={coinTone(s)} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="block text-sm text-ink3">{s.ticker}</span>
              </span>
            </Link>
            <div className="hidden md:block">
              <StatusBadge s={s} compact />
            </div>
            <div className="hidden text-[15px] text-ink2 md:block">
              {s.phase === 'raising' && `${usd(s.raised)} of ${usd(s.raiseTarget)} committed`}
              {s.phase === 'live' && `${usdCompact(s.treasury)} in treasury, ${usdCompact(s.volume24h)} traded today`}
              {s.phase === 'wound_down' && `${usd(s.refundPool)} left to refund`}
            </div>
            <div className="flex justify-end gap-2">
              {s.phase === 'raising' && (
                <button
                  className="btn btn-glass btn-sm"
                  onClick={() => {
                    const r = adminCloseRaise(s.id)
                    r.ok ? toast({ tone: 'ok', title: `${s.name} raise closed`, body: 'Treasury locked and trading opened.', coin: s.ticker }) : toast({ tone: 'error', title: 'Could not close the raise', body: r.error })
                  }}
                >
                  Close raise
                </button>
              )}
              {s.phase === 'live' &&
                (s.heartbeat === 'green' ? (
                  <button className="btn btn-danger btn-sm" onClick={() => adminSetHeartbeat(s.id, 'red')}>
                    Mark silent
                  </button>
                ) : (
                  <button className="btn btn-glass btn-sm" onClick={() => adminSetHeartbeat(s.id, 'green')}>
                    Mark alive
                  </button>
                ))}
              {s.phase === 'wound_down' && <span className="px-2 text-sm text-ink3">Closed</span>}
            </div>
            <div className="col-span-2 md:hidden">
              <StatusBadge s={s} compact />
            </div>
          </div>
        ))}
      </div>

      {/* Trades */}
      <h2 className="mb-4 mt-12 text-[28px]">Latest trades</h2>
      <div className="glass overflow-hidden">
        {trades.slice(0, 10).map(t => {
          const s = startups.find(x => x.id === t.startupId)
          return (
            <div key={t.id} className="row-line grid grid-cols-[64px_1fr_auto] items-center gap-3 px-4 py-3 text-[15px] first:border-t-0 sm:grid-cols-[80px_1fr_1fr_auto] sm:px-6">
              <span className={t.side === 'sell' ? 'font-semibold text-red' : 'font-semibold text-lime'}>{t.side === 'commit' ? 'Commit' : t.side === 'buy' ? 'Buy' : 'Sell'}</span>
              <span>
                {usd(t.usdc, 2)} <span className="text-ink3">of {s?.ticker}, {compact(t.tokens)} tokens</span>
              </span>
              <span className="hidden text-ink3 sm:block">{t.mine ? 'Connected wallet' : shortAddr(t.wallet)}</span>
              <span className="text-ink3">{ago(t.ts)}</span>
            </div>
          )
        })}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/[.08] p-5">
        <div>
          <div className="font-semibold">Reset the demo data</div>
          <div className="text-sm text-ink2">Restores the sample startups, queue, balances and month 0. Your changes in this browser are lost.</div>
        </div>
        {confirmReset ? (
          <div className="flex gap-2">
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                resetDemo()
                setConfirmReset(false)
                toast({ tone: 'ok', title: 'Demo data reset' })
              }}
            >
              Yes, reset
            </button>
            <button className="btn btn-glass btn-sm" onClick={() => setConfirmReset(false)}>
              Keep my changes
            </button>
          </div>
        ) : (
          <button className="btn btn-glass btn-sm" onClick={() => setConfirmReset(true)}>
            Reset demo data
          </button>
        )}
      </div>

      <Modal open={!!app} onClose={() => setOpenId(null)} title={app ? `Review ${app.name}` : ''} wide>
        {app && (
          <div>
            <div className="flex items-center gap-4">
              <Coin label={app.ticker} size={56} thick />
              <div className="min-w-0">
                <div className="text-ink2">{app.tagline || 'No description supplied'}</div>
                <div className="mt-1 text-sm text-ink3">
                  {app.founderName}, {app.founderRole}, {app.country}. Submitted {dateLong(app.submittedAt)}.
                </div>
              </div>
            </div>
            <dl className="m-0 mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[15px] sm:grid-cols-4">
              {[
                ['Raise target', usd(app.raiseTarget)],
                ['Monthly budget', usd(app.monthlyBudget)],
                ['Fee cap', usd(app.feeCap)],
                ['Category', app.category],
                ['Domain', app.website],
                ['Repository', app.github],
                ['Social', app.social],
                ['Email', app.email],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-sm text-ink3">{k}</dt>
                  <dd className="m-0 truncate font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {app.about && <p className="mt-4 text-[15px] text-ink2">{app.about}</p>}

            <div className="mt-5 flex items-center justify-between">
              <h3 className="text-[18px]">Checks</h3>
              {!allPass && app.status !== 'rejected' && app.status !== 'listed' && (
                <button
                  className="btn btn-glass btn-sm"
                  onClick={() => {
                    adminRunChecks(app.id)
                    toast({ tone: 'ok', title: 'Checks re-run', body: 'Simulated on devnet: open checks now pass.' })
                  }}
                >
                  <Icon name="refresh" size={15} />
                  Re-run checks
                </button>
              )}
            </div>
            <div className="glass-flat mt-3 p-4">
              <Checklist checks={app.checks} />
            </div>

            {app.status === 'rejected' && <p className="mt-5 rounded-2xl border border-red/30 bg-red/10 p-4 text-[15px] text-[#ffc2bb]">Rejected: {app.rejectionReason}</p>}
            {app.status === 'listed' && (
              <button
                className="btn btn-lime mt-5 w-full"
                onClick={() => {
                  setOpenId(null)
                  nav(`/s/${app.startupId}`)
                }}
              >
                Open the listing
              </button>
            )}

            {(app.status === 'submitted' || app.status === 'in_review' || app.status === 'scheduled') && (
              <div className="mt-6 grid gap-5 border-t border-white/[.08] pt-5 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="when">
                    Listing date
                  </label>
                  <input id="when" type="date" className="input" value={when} min={isoDay(Date.now())} onChange={e => setWhen(e.target.value)} />
                  <div className="mt-3 grid gap-2">
                    <button
                      className="btn btn-lime"
                      disabled={!allPass || !when}
                      onClick={() => {
                        adminSchedule(app.id, new Date(when + 'T12:00:00').getTime())
                        toast({ tone: 'ok', title: `${app.name} approved`, body: `Scheduled to list on ${dateLong(new Date(when + 'T12:00:00').getTime())}.` })
                        setOpenId(null)
                        setTab('scheduled')
                      }}
                    >
                      Approve and schedule
                    </button>
                    <button
                      className="btn btn-glass"
                      disabled={!allPass}
                      onClick={() => {
                        const r = adminListNow(app.id)
                        if (r.ok) {
                          toast({ tone: 'ok', title: `${app.name} is listed`, body: 'Its raise is open.', coin: app.ticker })
                          setOpenId(null)
                          nav(`/s/${r.message}`)
                        } else toast({ tone: 'error', title: 'Could not list', body: r.error })
                      }}
                    >
                      List now
                    </button>
                    {!allPass && <span className="text-sm text-ink3">Every check has to pass before you can approve.</span>}
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="reason">
                    Reason, if rejecting
                  </label>
                  <textarea id="reason" className="input" rows={3} placeholder="The founder sees this note." value={reason} onChange={e => setReason(e.target.value)} />
                  <button
                    className="btn btn-danger mt-3 w-full"
                    disabled={reason.trim().length < 8}
                    onClick={() => {
                      adminReject(app.id, reason.trim())
                      toast({ tone: 'info', title: `${app.name} rejected`, body: 'The founder can read your note.' })
                      setOpenId(null)
                      setTab('closed')
                    }}
                  >
                    Reject application
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
