import { useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Coin } from '../components/Coin'
import { CheckMark, Icon, PageHead, Panel, cx } from '../components/ui'
import { COUNTRIES } from '../data/countries'
import { CATEGORIES, GRADUATION_FEE, REVIEW_MAX_DAYS, REVIEW_MIN_DAYS, SUPPLY, TREASURY_SHARE, VERIFICATION_FEE } from '../config'
import { compact, pctPlain, price, usd } from '../lib/format'
import { useStore, useUi } from '../store/useStore'
import type { Draft } from '../store/types'

const steps = ['Founder', 'Startup', 'Verify', 'Token and budget', 'Review']

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-ink3">{hint}</span>}
    </label>
  )
}

function missing(d: Draft, step: number): string | null {
  if (step === 0) {
    if (!d.founderName.trim()) return 'Add your full name.'
    if (!d.founderRole.trim()) return 'Add your role.'
    if (!d.country) return 'Choose your country.'
    if (!/^\S+@\S+\.\S+$/.test(d.email)) return 'Add a valid email address.'
  }
  if (step === 1) {
    if (!d.name.trim()) return 'Add the startup name.'
    if (!/^[A-Za-z]{3,5}$/.test(d.ticker)) return 'The ticker needs 3 to 5 letters.'
    if (d.tagline.trim().length < 12) return 'Describe the product in one line.'
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(d.website.trim())) return 'Add your domain, for example acme.com.'
    if (!d.github.trim()) return 'Add the repository or organisation.'
    if (!d.social.trim()) return 'Add a social handle.'
  }
  if (step === 2) {
    const left = Object.entries(d.verified).filter(([, v]) => !v).length
    if (left) return `${left} ${left === 1 ? 'check is' : 'checks are'} still open.`
  }
  if (step === 3) {
    if (d.raiseTarget < 10_000) return 'The smallest raise is $10,000.'
    if (d.monthlyBudget < 500) return 'Set a monthly budget of at least $500.'
    if (d.monthlyBudget > d.raiseTarget * 0.25) return 'The monthly budget cannot exceed a quarter of the raise.'
    if (d.feeCap < 0) return 'The fee cap cannot be negative.'
  }
  return null
}

export default function ListWizard() {
  const draft = useStore(s => s.draft)
  const wallet = useStore(s => s.wallet)
  const { setDraft, submitApplication } = useStore.getState()
  const { toast, openConnect } = useUi()
  const nav = useNavigate()
  const [running, setRunning] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const step = draft.step
  const problem = missing(draft, step)
  const set = (patch: Partial<Draft>) => setDraft(patch)
  const input = (key: keyof Draft, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="input" value={draft[key] as string} onChange={e => set({ [key]: e.target.value } as Partial<Draft>)} {...props} />
  )

  const verify = (key: keyof Draft['verified']) => {
    setRunning(key)
    setTimeout(() => {
      setDraft({ verified: { ...useStore.getState().draft.verified, [key]: true } })
      setRunning(null)
    }, 1300)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.code)
      toast({ tone: 'ok', title: 'Copied the DNS record' })
    } catch {
      toast({ tone: 'info', title: 'Select the record and copy it by hand' })
    }
  }
  const submit = () => {
    if (!wallet.address) return openConnect(true)
    setSubmitting(true)
    setTimeout(() => {
      const ticker = draft.ticker.toUpperCase()
      const r = submitApplication()
      setSubmitting(false)
      if (r.ok) {
        toast({ tone: 'ok', title: 'Application submitted', body: `Review takes ${REVIEW_MIN_DAYS} to ${REVIEW_MAX_DAYS} days. Track it on the Founder page.`, coin: ticker })
        nav('/founder')
      } else toast({ tone: 'error', title: 'Could not submit', body: r.error })
    }, 900)
  }

  const salePrice = draft.raiseTarget / SUPPLY.sale
  const treasury = draft.raiseTarget * (1 - GRADUATION_FEE) * TREASURY_SHARE
  const runway = draft.monthlyBudget > 0 ? treasury / draft.monthlyBudget : 0

  const rows: { key: keyof Draft['verified']; icon: string; title: string; body: ReactNode; action: string }[] = [
    { key: 'kyc', icon: 'shield', title: 'Founder identity', body: 'A sandbox identity check. No documents are collected on devnet.', action: 'Run identity check' },
    {
      key: 'domain',
      icon: 'globe',
      title: `Domain ownership${draft.website ? ', ' + draft.website : ''}`,
      body: (
        <>
          Add this TXT record to your DNS, then check it.
          <span className="mt-2 flex items-center gap-2">
            <code className="glass-flat min-w-0 flex-1 truncate px-3 py-2 text-sm text-ink" style={{ borderRadius: 12 }}>
              {draft.code}
            </code>
            <button type="button" className="btn btn-glass btn-sm" onClick={copy}>
              <Icon name="copy" size={15} />
              Copy
            </button>
          </span>
        </>
      ),
      action: 'Check DNS record',
    },
    { key: 'github', icon: 'code', title: `Code repository${draft.github ? ', ' + draft.github : ''}`, body: 'Sign in with GitHub so we can confirm you own the repository and read its commit activity.', action: 'Connect GitHub' },
    { key: 'socials', icon: 'at', title: `Social account${draft.social ? ', ' + draft.social : ''}`, body: 'Sign in with the account to prove you control it.', action: 'Connect account' },
  ]

  return (
    <div className="mx-auto max-w-[820px]">
      <PageHead title="List your startup" lead={`Five steps, then a reviewer takes ${REVIEW_MIN_DAYS} to ${REVIEW_MAX_DAYS} days. Your answers are saved as you go.`} />

      <ol className="scroll-x m-0 mb-5 flex list-none gap-2 p-0">
        {steps.map((label, i) => (
          <li key={label} className="flex-none">
            <button className="chip" data-on={i === step} disabled={i > step} onClick={() => set({ step: i })} aria-current={i === step ? 'step' : undefined}>
              <span className={cx('grid h-5 w-5 place-items-center rounded-full text-[12px] font-bold', i < step ? 'bg-lime text-black' : 'bg-white/10')}>{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <Panel key={step} className="swap-in">
        {step === 0 && (
          <div className="grid gap-5">
            <h2 className="text-[24px]">Who is behind it</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Full name">{input('founderName', { placeholder: 'Ada Lovelace', autoComplete: 'name' })}</Field>
              <Field label="Role">{input('founderRole', { placeholder: 'CEO and co-founder' })}</Field>
              <Field label="Country" hint="Your startup shows up on the globe here.">
                <select className="input" value={draft.country} onChange={e => set({ country: e.target.value })}>
                  <option value="">Choose a country</option>
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Work email" hint="Review updates go here.">{input('email', { placeholder: 'you@startup.com', type: 'email', autoComplete: 'email' })}</Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-5">
            <h2 className="text-[24px]">What you are building</h2>
            <div className="grid gap-5 sm:grid-cols-[1fr_150px_190px]">
              <Field label="Startup name">{input('name', { placeholder: 'Acme Robotics' })}</Field>
              <Field label="Ticker">{input('ticker', { placeholder: 'ACME', maxLength: 5, style: { textTransform: 'uppercase' } })}</Field>
              <Field label="Category">
                <select className="input" value={draft.category} onChange={e => set({ category: e.target.value })}>
                  {CATEGORIES.map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="One-line description" hint="Say what the product does and for whom.">{input('tagline', { placeholder: 'Warehouse robots that small sellers can rent by the hour', maxLength: 90 })}</Field>
            <Field label="About">
              <textarea className="input" rows={4} placeholder="What problem you solve, what exists today, what the raise pays for." value={draft.about} onChange={e => set({ about: e.target.value })} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Domain" hint="Your own domain, not a free subdomain.">{input('website', { placeholder: 'acme.com' })}</Field>
              <Field label="GitHub">{input('github', { placeholder: 'github.com/acme' })}</Field>
              <Field label="Social handle">{input('social', { placeholder: '@acme' })}</Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-[24px]">Prove it is yours</h2>
            <p className="mt-1.5 text-ink2">These four checks run again on a schedule after you list. That repeat is your heartbeat.</p>
            <ul className="m-0 mt-5 list-none p-0">
              {rows.map(r => {
                const done = draft.verified[r.key]
                return (
                  <li key={r.key} className="grid gap-3 border-t border-white/[.07] py-4 first:border-t-0 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="flex min-w-0 items-start gap-3.5">
                      <span className="mt-0.5 grid h-10 w-10 flex-none place-items-center rounded-full bg-white/[.06] text-ink2">
                        <Icon name={r.icon} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold">{r.title}</div>
                        <div className="text-[15px] text-ink2">{r.body}</div>
                      </div>
                    </div>
                    {done ? (
                      <span className="inline-flex items-center gap-2 justify-self-start font-semibold text-lime sm:justify-self-end">
                        <CheckMark status="passed" /> Passed
                      </span>
                    ) : (
                      <button className="btn btn-glass btn-sm justify-self-start sm:justify-self-end" disabled={running !== null} onClick={() => verify(r.key)}>
                        {running === r.key && <Coin label="" size={18} spin />}
                        {running === r.key ? 'Checking' : r.action}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="mt-4 rounded-2xl border border-white/[.08] bg-white/[.03] p-3.5 text-sm text-ink2">On devnet these checks are simulated and always pass. The real ones call the DNS, GitHub and identity providers.</p>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-5">
            <h2 className="text-[24px]">Your raise and your budget</h2>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Raise target, USDC">
                <input className="input" type="number" min={10000} step={5000} value={draft.raiseTarget} onChange={e => set({ raiseTarget: Number(e.target.value) })} />
              </Field>
              <Field label="Monthly budget, USDC" hint="Released from the treasury each month.">
                <input className="input" type="number" min={500} step={500} value={draft.monthlyBudget} onChange={e => set({ monthlyBudget: Number(e.target.value) })} />
              </Field>
              <Field label="Monthly fee cap, USDC" hint="The most you can take from trading fees.">
                <input className="input" type="number" min={0} step={100} value={draft.feeCap} onChange={e => set({ feeCap: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="glass-flat grid gap-x-8 gap-y-4 p-5 sm:grid-cols-3">
              {[
                ['Price per token', price(salePrice)],
                ['Locked in treasury', usd(treasury)],
                ['Runway at this budget', runway.toFixed(1) + ' months'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-sm text-ink3">{k}</div>
                  <div className="font-display text-[24px] font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="text-[15px] text-ink2">
              <div className="mb-2 font-semibold text-ink">How {compact(SUPPLY.total)} tokens are split</div>
              {[
                [`Sold in the raise`, SUPPLY.sale],
                ['Trading liquidity', SUPPLY.liquidity],
                ['You, locked 12 months then released over 24', SUPPLY.founders],
                ['Platform, same lock', SUPPLY.platform],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between border-t border-white/[.06] py-2">
                  <span>{k}</span>
                  <span className="font-semibold text-ink">{pctPlain((v as number) / SUPPLY.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div className="flex items-center gap-4">
              <Coin label={draft.ticker.toUpperCase() || '?'} size={64} thick hover />
              <div className="min-w-0">
                <h2 className="truncate text-[26px]">{draft.name}</h2>
                <p className="m-0 text-ink2">{draft.tagline}</p>
              </div>
            </div>
            <dl className="m-0 mt-6 grid gap-x-8 text-[15px] sm:grid-cols-2">
              {[
                ['Founder', `${draft.founderName}, ${draft.founderRole}`],
                ['Country', draft.country],
                ['Domain', draft.website],
                ['Repository', draft.github],
                ['Social', draft.social],
                ['Category', draft.category],
                ['Raise target', usd(draft.raiseTarget)],
                ['Monthly budget', usd(draft.monthlyBudget)],
                ['Monthly fee cap', usd(draft.feeCap)],
                ['Checks passed', '4 of 4 automated'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-t border-white/[.06] py-2.5">
                  <dt className="text-ink3">{k}</dt>
                  <dd className="m-0 truncate text-right font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 flex gap-3 rounded-2xl border border-bluehi/25 bg-blue/15 p-4 text-[15px]">
              <Icon name="calendar" className="mt-0.5 text-bluehi" />
              <p className="m-0">
                Submitting costs a {usd(VERIFICATION_FEE)} verification fee in demo USDC. A reviewer answers within {REVIEW_MIN_DAYS} to {REVIEW_MAX_DAYS} days and schedules your listing date.
              </p>
            </div>
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] pt-5">
          <button className="btn btn-glass" disabled={step === 0} onClick={() => set({ step: step - 1 })}>
            Back
          </button>
          <div className="flex items-center gap-4">
            {problem && <span className="text-sm text-ink3">{problem}</span>}
            {step < 4 ? (
              <button className="btn btn-lime" disabled={!!problem} onClick={() => set({ step: step + 1 })}>
                Continue
              </button>
            ) : (
              <button className="btn btn-lime" disabled={submitting} onClick={submit}>
                {submitting && <Coin label="" size={20} spin />}
                {!wallet.address ? 'Connect wallet to submit' : submitting ? 'Submitting' : `Pay ${usd(VERIFICATION_FEE)} and submit`}
              </button>
            )}
          </div>
        </div>
      </Panel>
    </div>
  )
}
