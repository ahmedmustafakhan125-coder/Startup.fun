import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { REVIEW_MAX_DAYS, REVIEW_MIN_DAYS, TREASURY_SHARE, WINDDOWN_DAYS } from '../config'
import { Coin } from './Coin'
import { HeartbeatBadge, Icon, cx } from './ui'

/** How long each step stays on stage. */
const STEP_MS = 5200
/** `--d` is the delay before an element's animation starts. */
const delay = (seconds: number) => ({ '--d': `${seconds}s` }) as CSSProperties
const pctOf = (share: number) => `${Math.round(share * 100)}%`

function VerifyScene() {
  const checks = [
    ['user', 'Identity'],
    ['globe', 'Domain'],
    ['code', 'Code'],
    ['at', 'Social accounts'],
  ]
  return (
    <div className="w-full max-w-[520px]">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        {checks.map(([icon, label], i) => (
          <div key={label} className="hiw-lit glass-flat flex items-center gap-2.5 p-3 sm:p-3.5" style={delay(0.4 + i * 0.7)}>
            <Icon name={icon} className="text-ink2" />
            <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
            <span className="hiw-tick">
              <Icon name="check" size={14} />
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm text-ink2">Each check proves the founders control what they list.</span>
        <span className="hiw-pop badge badge-green" style={delay(3.4)}>
          <Icon name="shield" size={14} />
          Verified
        </span>
      </div>
    </div>
  )
}

function ReviewScene() {
  const decided = Math.round((REVIEW_MIN_DAYS + REVIEW_MAX_DAYS) / 2)
  return (
    <div className="w-full max-w-[520px]">
      <div className="mb-2.5 flex justify-between text-sm text-ink3">
        <span>Day 1</span>
        <span>Day {REVIEW_MIN_DAYS}</span>
        <span>Day {REVIEW_MAX_DAYS}</span>
      </div>
      <div className="grid gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${REVIEW_MAX_DAYS}, minmax(0, 1fr))` }}>
        {Array.from({ length: REVIEW_MAX_DAYS }, (_, i) => (
          <span key={i} className={cx('hiw-day', i < decided && 'hiw-day-on')} data-window={i >= REVIEW_MIN_DAYS - 1} style={delay(0.3 + i * 0.2)} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm text-ink2">A reviewer reads the application and the automated results.</span>
        <span className="hiw-pop badge badge-green" style={delay(0.5 + decided * 0.2)}>
          <Icon name="calendar" size={14} />
          Listing scheduled
        </span>
      </div>
    </div>
  )
}

function RaiseScene() {
  return (
    <div className="w-full max-w-[520px]">
      <div className="flex justify-around px-6" aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <span key={i} className="hiw-drop" style={delay(0.2 + i * 0.4)}>
            <Coin label="" size={26} front="$" />
          </span>
        ))}
      </div>
      <div className="mt-1 flex items-baseline justify-between text-[15px]">
        <span className="font-semibold">Raise</span>
        <span className="text-sm text-ink2">one fixed price for every backer</span>
      </div>
      <div className="hiw-track mt-2">
        <div className="hiw-grow" style={{ ...delay(0.4), background: '#6ea2ff' }} />
      </div>
      <div className="mt-5 grid gap-2.5" style={{ gridTemplateColumns: `${TREASURY_SHARE}fr ${1 - TREASURY_SHARE}fr` }}>
        <div className="hiw-pop min-w-0" style={delay(2.3)}>
          <div className="h-2.5 rounded-full bg-lime" />
          <div className="mt-2 font-semibold">{pctOf(TREASURY_SHARE)} treasury</div>
          <div className="text-sm text-ink2">Locked in escrow</div>
        </div>
        <div className="hiw-pop min-w-0" style={delay(2.8)}>
          <div className="h-2.5 rounded-full bg-bluehi" />
          <div className="mt-2 font-semibold">{pctOf(1 - TREASURY_SHARE)}</div>
          <div className="text-sm text-ink2">Liquidity</div>
        </div>
      </div>
    </div>
  )
}

// Three beats on a flat line, drawn left to right.
const pulse = 'M0 34' + [70, 240, 410].map(x => `H${x}l7 -5 7 5h7l7 -27 9 48 7 -21h7l8 -7 8 7`).join('') + 'H520'

function HeartbeatScene() {
  return (
    <div className="w-full max-w-[520px]">
      <div className="flex items-center justify-between gap-3">
        <HeartbeatBadge hb="green" />
        <span className="text-sm text-ink3">the same checks, on a schedule</span>
      </div>
      <svg viewBox="0 0 520 68" className="mt-2 block h-[60px] w-full" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 34H520" stroke="rgba(255,255,255,.08)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
        <path className="hiw-pulse" d={pulse} pathLength={1} stroke="#d4ff24" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:gap-2.5">
        {[1, 2, 3].map(m => (
          <div key={m} className="hiw-lit glass-flat flex items-center justify-between gap-2 p-2.5 sm:p-3" style={delay(0.15 + m * 0.95)}>
            <span className="min-w-0">
              <span className="block text-sm text-ink3">Month {m}</span>
              <span className="block truncate text-[15px] font-semibold">Budget paid</span>
            </span>
            <span className="hiw-tick">
              <Icon name="check" size={14} />
            </span>
          </div>
        ))}
      </div>
      <p className="hiw-pop mb-0 mt-3 text-sm text-ink2" style={delay(3.6)}>
        Silent for {WINDDOWN_DAYS} days? Payouts stop and what is left goes back to holders.
      </p>
    </div>
  )
}

const steps = [
  { icon: 'shield', title: 'Apply and verify', body: 'Founders pass identity checks and prove they control the domain, the code and the social accounts.', Scene: VerifyScene },
  { icon: 'calendar', title: `Review, ${REVIEW_MIN_DAYS} to ${REVIEW_MAX_DAYS} days`, body: 'A reviewer reads the application and the automated results, then schedules or rejects the listing.', Scene: ReviewScene },
  { icon: 'vault', title: 'Raise into escrow', body: `Backers buy at one fixed price. ${pctOf(TREASURY_SHARE)} of proceeds lock in the treasury and ${pctOf(1 - TREASURY_SHARE)} becomes trading liquidity.`, Scene: RaiseScene },
  { icon: 'pulse', title: 'Trade, with a heartbeat', body: 'The same checks keep running. Passing keeps the money flowing. Silence pauses it, then refunds it.', Scene: HeartbeatScene },
]

/** The four steps from application to trading, played as a short looping animation. */
export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  // Bumped to replay the current scene from its first frame.
  const [run, setRun] = useState(0)
  const [inView, setInView] = useState(false)
  // Visitors who asked for less motion get the steps without the loop, and can still click through them.
  const [playing, setPlaying] = useState(() => typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  // The loop only runs while the section is on screen, and starts its scene over when it comes back.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return setInView(true)
    const seen = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting)
        if (entry.isIntersecting) setRun(r => r + 1)
      },
      { threshold: 0.3 },
    )
    seen.observe(el)
    return () => seen.disconnect()
  }, [])

  const running = playing && inView
  useEffect(() => {
    if (!running) return
    const next = setTimeout(() => setStep(s => (s + 1) % steps.length), STEP_MS)
    return () => clearTimeout(next)
  }, [running, step, run])

  const go = (i: number) => {
    setStep(i)
    setRun(r => r + 1)
  }
  const { Scene } = steps[step]

  return (
    <section className="mt-20" aria-labelledby="how-it-works">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <h2 id="how-it-works" className="text-[30px] sm:text-[38px]" style={{ fontStretch: '85%' }}>
          How it works
        </h2>
        <button className="btn btn-glass btn-sm" onClick={() => setPlaying(p => !p)} aria-pressed={!playing}>
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <div ref={ref} className="glass overflow-hidden" style={{ '--step-ms': `${STEP_MS}ms` } as CSSProperties}>
        <div className="hiw-stage">
          <div key={`${step}-${run}`} className="hiw-scene">
            <div className="mb-4 text-sm font-semibold text-lime">
              Step {step + 1} of {steps.length}
              <span className="ml-2 font-normal text-ink2">{steps[step].title}</span>
            </div>
            <Scene />
          </div>
        </div>
        <ol className="m-0 grid list-none p-0 md:grid-cols-4">
          {steps.map((s, i) => {
            const on = i === step
            return (
              <li key={s.title} className="border-t border-white/[.07] md:border-l md:first:border-l-0">
                <button className="hiw-step" aria-current={on ? 'step' : undefined} onClick={() => go(i)}>
                  {on && <span key={`${run}-${running}`} className="hiw-bar" data-run={running} />}
                  <span className="flex items-center justify-between">
                    <span className={cx('grid h-10 w-10 place-items-center rounded-full bg-white/[.07] transition-colors', on ? 'text-lime' : 'text-ink2')}>
                      <Icon name={s.icon} size={20} />
                    </span>
                    <span className={cx('font-display text-[34px] font-semibold leading-none transition-colors', on ? 'text-lime' : 'text-white/15')}>{i + 1}</span>
                  </span>
                  <span className="mt-4 block font-display text-[19px] font-semibold leading-tight">{s.title}</span>
                  {/* Phones show the text of the current step only, so the stage stays in view. */}
                  <span className={cx('mt-2 text-[15px] text-ink2', on ? 'block' : 'hidden md:block')}>{s.body}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
