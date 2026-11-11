import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { BRAND, DEMO_AIRDROP, NETWORK } from '../config'
import { shortAddr, usd } from '../lib/format'
import { useStore, useUi } from '../store/useStore'
import { Coin } from './Coin'
import { Icon, Modal, cx } from './ui'

const links = [
  { to: '/explore', label: 'Explore', icon: 'grid' },
  { to: '/list', label: 'List a startup', short: 'List', icon: 'plus' },
  { to: '/portfolio', label: 'Portfolio', icon: 'wallet' },
  { to: '/founder', label: 'Founder', icon: 'briefcase' },
  { to: '/admin', label: 'Admin', icon: 'gauge' },
]

type PhantomProvider = { connect: () => Promise<{ publicKey: { toString(): string } }>; disconnect?: () => Promise<void> }
function getPhantom(): PhantomProvider | null {
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider & { isPhantom?: boolean } }
  return w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : null)
}

export function WalletButton() {
  const wallet = useStore(s => s.wallet)
  const openConnect = useUi(s => s.openConnect)
  if (!wallet.address)
    return (
      <button className="btn btn-lime btn-sm" onClick={() => openConnect(true)}>
        Connect wallet
      </button>
    )
  return (
    <button className="btn btn-glass btn-sm" onClick={() => openConnect(true)} aria-label="Wallet">
      <span className="font-semibold">{usd(wallet.usdc, 0)}</span>
      <span className="hidden text-ink3 sm:inline">{shortAddr(wallet.address)}</span>
    </button>
  )
}

export function ConnectModal() {
  const { connectOpen, openConnect, toast } = useUi()
  const wallet = useStore(s => s.wallet)
  const connect = useStore(s => s.connect)
  const disconnect = useStore(s => s.disconnect)
  const airdrop = useStore(s => s.airdrop)
  const [busy, setBusy] = useState(false)
  const phantom = typeof window !== 'undefined' ? getPhantom() : null
  const close = () => openConnect(false)

  const usePhantom = async () => {
    if (!phantom) return
    setBusy(true)
    try {
      const res = await phantom.connect()
      connect('phantom', res.publicKey.toString())
      toast({ tone: 'ok', title: 'Phantom connected', body: 'Balances here are demo USDC until the devnet program is wired in.' })
      close()
    } catch {
      toast({ tone: 'error', title: 'Phantom did not connect', body: 'The request was rejected or the wallet is locked.' })
    } finally {
      setBusy(false)
    }
  }

  if (wallet.address)
    return (
      <Modal open={connectOpen} onClose={close} title="Your wallet">
        <div className="glass-flat p-4">
          <div className="text-sm text-ink3">{wallet.kind === 'phantom' ? 'Phantom' : 'Demo wallet'} on {NETWORK}</div>
          <div className="mt-1 break-all text-[15px] text-ink2">{wallet.address}</div>
          <div className="mt-4 font-display text-3xl font-semibold">{usd(wallet.usdc, 2)}</div>
          <div className="text-sm text-ink3">Demo USDC</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            className="btn btn-lime"
            onClick={() => {
              airdrop()
              toast({ tone: 'ok', title: `Added ${usd(DEMO_AIRDROP)} demo USDC` })
            }}
          >
            Get {usd(DEMO_AIRDROP)}
          </button>
          <button
            className="btn btn-glass"
            onClick={() => {
              disconnect()
              close()
            }}
          >
            Disconnect
          </button>
        </div>
      </Modal>
    )

  return (
    <Modal open={connectOpen} onClose={close} title="Connect a wallet">
      <p className="mb-5 text-ink2">Everything runs on {NETWORK.toLowerCase()} with demo USDC. No real money moves.</p>
      <div className="grid gap-3">
        <button
          className="glass-flat flex items-center gap-4 p-4 text-left transition hover:bg-white/[.07]"
          onClick={() => {
            connect('demo')
            toast({ tone: 'ok', title: 'Demo wallet connected', body: 'It holds demo USDC, three positions and one listed startup.' })
            close()
          }}
        >
          <Coin label="D" size={44} />
          <span>
            <span className="block font-semibold">Demo wallet</span>
            <span className="block text-sm text-ink2">Pre-loaded, works in any browser</span>
          </span>
        </button>
        <button className="glass-flat flex items-center gap-4 p-4 text-left transition enabled:hover:bg-white/[.07] disabled:opacity-50" disabled={!phantom || busy} onClick={usePhantom}>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/10">
            <Icon name="wallet" size={22} />
          </span>
          <span>
            <span className="block font-semibold">Phantom</span>
            <span className="block text-sm text-ink2">{phantom ? (busy ? 'Waiting for approval' : 'Detected in this browser') : 'Not detected in this browser'}</span>
          </span>
        </button>
      </div>
    </Modal>
  )
}

export function Nav() {
  const { pathname } = useLocation()
  return (
    <>
      <header className="fixed left-0 right-0 top-3 z-50 px-3 sm:top-4">
        <div className="glass-bar mx-auto flex h-[58px] max-w-[1180px] items-center gap-2 pl-3 pr-2.5">
          <Link to="/" className="coin-host mr-1 flex items-center gap-2.5 rounded-full pr-2" aria-label={`${BRAND} home`}>
            <Coin label="O" size={32} hover />
            <span className="font-display text-[19px] font-semibold tracking-tight">{BRAND}</span>
          </Link>
          <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map(l => (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => cx('rounded-full px-3.5 py-2 text-[15px] font-medium transition', isActive ? 'bg-white/10 text-ink' : 'text-ink2 hover:text-ink')}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="badge badge-blue hidden sm:inline-flex">{NETWORK}</span>
            <WalletButton />
          </div>
        </div>
      </header>
      <nav className="fixed bottom-3 left-0 right-0 z-50 px-3 md:hidden" aria-label="Main">
        <div className="glass-bar mx-auto flex h-[62px] max-w-[460px] items-stretch justify-between px-2" style={{ borderRadius: 26 }}>
          {links.map(l => {
            const on = pathname.startsWith(l.to)
            return (
              <Link key={l.to} to={l.to} className={cx('flex flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11.5px] font-medium', on ? 'text-lime' : 'text-ink2')} aria-current={on ? 'page' : undefined}>
                <Icon name={l.icon} size={21} />
                {l.short ?? l.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}

export function Toasts() {
  const { toasts, dismiss } = useUi()
  return (
    <div className="fixed bottom-[86px] left-0 right-0 z-[70] flex flex-col items-center gap-2 px-3 md:bottom-6 md:left-auto md:right-6 md:items-end" aria-live="polite">
      {toasts.map(t => (
        <button key={t.id} onClick={() => dismiss(t.id)} className="glass-bar toast-in flex w-full max-w-[380px] items-center gap-3 py-3 pl-3 pr-5 text-left" style={{ borderRadius: 22 }}>
          {t.coin ? (
            <Coin label={t.coin} size={38} land />
          ) : (
            <span className={cx('grid h-9 w-9 flex-none place-items-center rounded-full', t.tone === 'error' ? 'bg-red/15 text-red' : t.tone === 'ok' ? 'bg-lime/15 text-lime' : 'bg-white/10 text-ink')}>
              <Icon name={t.tone === 'error' ? 'alert' : t.tone === 'ok' ? 'check' : 'clock'} size={18} />
            </span>
          )}
          <span className="min-w-0">
            <span className="block font-semibold leading-snug">{t.title}</span>
            {t.body && <span className="block text-sm leading-snug text-ink2">{t.body}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

export function Footer() {
  return (
    <footer className="mx-auto mt-24 max-w-[1180px] px-5 pb-32 text-sm text-ink3 md:pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] pt-6">
        <span>
          {BRAND} runs on Solana {NETWORK.toLowerCase()} with demo funds. Startups and figures shown here are sample data.
        </span>
        <span>Tokens are not shares and carry no claim beyond the on-chain refund rule.</span>
      </div>
    </footer>
  )
}
