import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { explorerAddress, PROGRAM_ID } from '../chain/client'
import { Logo } from '../components/Logo'
import { Icon, PageHead, Panel } from '../components/ui'
import { ABOUT, BRAND, NETWORK, WINDDOWN_DAYS } from '../config'
import { useUi } from '../store/useStore'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row-line grid gap-1 py-4 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[170px_minmax(0,1fr)] sm:items-center sm:gap-4">
      <dt className="text-sm text-ink3">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  )
}

export default function About() {
  const toast = useUi(u => u.toast)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(PROGRAM_ID)
      toast({ tone: 'ok', title: 'Copied the program ID' })
    } catch {
      toast({ tone: 'info', title: 'Select the program ID and copy it by hand' })
    }
  }

  return (
    <div>
      <PageHead title={`About ${BRAND}`} lead="A funding platform where the money follows the work. Founders are paid month by month, and only while they can show they are still building." />

      <div className="grid items-start gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <Panel>
          <div className="flex items-center gap-3.5">
            <Logo size={52} />
            <h2 className="text-[24px]">How {BRAND} works</h2>
          </div>
          <ul className="m-0 mt-5 grid list-none gap-4 p-0">
            {[
              ['shield', 'Every startup is verified', 'Founders prove who they are and that they control the domain, the code and the social accounts they list.'],
              ['vault', 'The raise sits in escrow', 'Backers buy a token at one fixed price. Most of the money is locked in a treasury, and the rest opens trading.'],
              ['pulse', 'Payouts follow a heartbeat', 'The same checks keep running. While they pass, founders can claim that month’s budget. When they fail, payouts pause.'],
              ['refresh', `Silence means a refund`, `After ${WINDDOWN_DAYS} silent days the startup winds down and what is left goes back to token holders.`],
            ].map(([icon, title, body]) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 grid h-10 w-10 flex-none place-items-center rounded-full bg-white/[.07] text-lime">
                  <Icon name={icon} size={20} />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-[15px] text-ink2">{body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/explore" className="btn btn-lime">
              Explore startups
            </Link>
            <Link to="/trade" className="btn btn-glass">
              Trade coins
            </Link>
          </div>
        </Panel>

        {ABOUT.name && (
          <Panel>
            <div className="text-sm text-ink3">Built by</div>
            <div className="mt-3 flex items-center gap-4">
              <span className="grid h-14 w-14 flex-none place-items-center rounded-full bg-lime font-display text-[20px] font-bold text-black">{initials(ABOUT.name)}</span>
              <div className="min-w-0">
                <h2 className="text-[24px]">{ABOUT.name}</h2>
                {ABOUT.role && <div className="text-ink2">{ABOUT.role}</div>}
              </div>
            </div>
            {ABOUT.bio && <p className="mb-0 mt-4 text-[15px] text-ink2">{ABOUT.bio}</p>}
            {ABOUT.links.length > 0 && (
              <div className="mt-5 grid gap-2">
                {ABOUT.links.map(l => (
                  <a key={l.href} href={l.href} target={l.href.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer" className="glass-flat flex items-center justify-between gap-3 px-4 py-3 font-semibold transition hover:bg-white/[.07]">
                    <span className="min-w-0 break-all text-[15px] sm:text-base">{l.label}</span>
                    <Icon name="external" size={16} className="text-ink3" />
                  </a>
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>

      <Panel className="mt-5">
        <h2 className="text-[24px]">The program</h2>
        <p className="mt-1.5 max-w-[70ch] text-ink2">
          Every raise, trade, payout and refund is carried out by one Solana program. Anyone can look it up and read what it has done.
        </p>
        <dl className="m-0 mt-5">
          <Row label="Program ID">
            <div className="flex flex-wrap items-center gap-2.5">
              <code className="min-w-0 break-all font-sans text-[15px] font-semibold text-ink">{PROGRAM_ID}</code>
              <button className="btn btn-glass btn-sm" onClick={copy}>
                <Icon name="copy" size={15} />
                Copy
              </button>
              <a className="btn btn-glass btn-sm" href={explorerAddress(PROGRAM_ID)} target="_blank" rel="noreferrer">
                <Icon name="external" size={15} />
                View on Solana Explorer
              </a>
            </div>
          </Row>
          <Row label="Network">
            <span className="badge badge-blue">Solana {NETWORK.toLowerCase()}</span>
            <span className="ml-2.5 text-[15px] text-ink2">Demo USDC only. No real money moves.</span>
          </Row>
          {ABOUT.source && (
            <Row label="Source code">
              <a className="inline-flex items-center gap-1.5 break-all font-semibold underline" href={ABOUT.source} target="_blank" rel="noreferrer">
                {ABOUT.source.replace(/^https:\/\//, '')}
                <Icon name="external" size={15} className="text-ink3" />
              </a>
            </Row>
          )}
        </dl>
      </Panel>
    </div>
  )
}
