// Reads program state from devnet and shapes it into the objects the pages already render.
// Profiles (name, tagline, links) come from the bundled sample data until the backend serves them
// (Phase 6); volume, backers and price history need the indexer (Phase 8) and stay empty.
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { type Address, type Base58EncodedBytes, getBase58Decoder } from '@solana/kit'
import {
  type Config,
  fetchConfig,
  findConfigPda,
  findFeeVaultPda,
  findFounderLockPda,
  findMintPda,
  findPlatformLockPda,
  findPoolTokenPda,
  findPoolUsdcPda,
  findRefundVaultPda,
  findReserveVaultPda,
  findTreasuryVaultPda,
  getStartupDecoder,
  Heartbeat,
  OBVERSE_PROGRAM_ADDRESS,
  Phase,
  type Startup as ChainStartup,
  STARTUP_DISCRIMINATOR,
} from '../../../sdk/src/index.ts'
import { GRADUATION_FEE, SUPPLY, TREASURY_SHARE, WINDDOWN_DAYS } from '../config'
import { allPassed, seedStartups } from '../data/seed'
import type { Holding, Startup } from '../store/types'
import { rpc } from './client'

const UNIT = 1e6
const ui = (baseUnits: bigint) => Number(baseUnits) / UNIT

export async function ata(owner: Address, mint: Address): Promise<Address> {
  return (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]
}

/** Program-wide addresses and settings. Fetched once; they only change by admin action. */
export interface Ctx {
  config: Config
  platformUsdc: Address
}
let ctx: Promise<Ctx> | undefined
export const getCtx = () =>
  (ctx ??= (async () => {
    const config = (await fetchConfig(rpc, (await findConfigPda())[0])).data
    return { config, platformUsdc: await ata(config.platformWallet, config.usdcMint) }
  })().catch(error => {
    ctx = undefined
    throw error
  }))

/** The on-chain addresses behind one startup id, for building transactions. */
export interface Ref {
  startup: Address
  mint: Address
}
const refs = new Map<string, Ref>()
export const refOf = (id: string) => refs.get(id)

const VAULTS = [
  findMintPda,
  findTreasuryVaultPda,
  findFeeVaultPda,
  findReserveVaultPda,
  findPoolUsdcPda,
  findPoolTokenPda,
  findRefundVaultPda,
  findFounderLockPda,
  findPlatformLockPda,
] as const
const vaultCache = new Map<Address, Promise<Address[]>>()
const vaultsOf = (startup: Address) => {
  let found = vaultCache.get(startup)
  if (!found) vaultCache.set(startup, (found = Promise.all(VAULTS.map(async find => (await find({ startup }))[0]))))
  return found
}

const bytes = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0))
const u64At = (data: Uint8Array, offset: number) => new DataView(data.buffer, data.byteOffset).getBigUint64(offset, true)

/** Token account balances (or mint supplies) for many addresses, 0 where the account does not exist. */
async function amounts(addresses: Address[], offset = 64): Promise<bigint[]> {
  const out: bigint[] = []
  for (let i = 0; i < addresses.length; i += 100) {
    const { value } = await rpc.getMultipleAccounts(addresses.slice(i, i + 100), { encoding: 'base64' }).send()
    for (const account of value) out.push(account ? u64At(bytes(account.data[0]), offset) : 0n)
  }
  return out
}

const profiles = new Map(seedStartups().map(s => [s.ticker, s]))
const blankProfile = (ticker: string): Startup => ({
  ...seedStartups()[0],
  id: ticker.toLowerCase(),
  name: ticker,
  ticker,
  tagline: 'Listed on devnet',
  about: 'This startup has no profile yet.',
  category: 'Other',
  country: '',
  website: '',
  github: '',
  social: '',
  founders: [],
  checks: allPassed('', '', ''),
})

function toStartup(c: ChainStartup, config: Config, balance: Record<string, bigint>, owner: string | null): Startup {
  const profile = profiles.get(c.ticker) ?? blankProfile(c.ticker)
  const now = Math.floor(Date.now() / 1000)
  const month = Number(config.monthSeconds)
  const live = c.phase === Phase.Live
  const red = c.heartbeat === Heartbeat.Red
  const raiseTarget = ui(c.raiseTarget)
  const raised = ui(c.raised)
  const salePrice = raiseTarget / SUPPLY.sale
  const poolUsdc = live ? ui(balance.poolUsdc) : 0
  const poolTokens = live ? ui(balance.poolToken) : 0
  const refundPerToken = c.refundCirculating > 0n ? Number(c.refundPool) / Number(c.refundCirculating) : 0
  const current = c.phase === Phase.Raising ? salePrice : live ? poolUsdc / poolTokens : refundPerToken
  const period = live ? Math.floor((now - Number(c.liveAt)) / month) : 0
  const redSeconds = red ? now - Number(c.redSince) : 0
  const greenSeconds = live ? now - Number(c.liveAt) - Number(c.redSecondsTotal) - redSeconds : 0
  const locked = balance.founderLock + balance.platformLock + balance.poolToken
  return {
    ...profile,
    mine: owner === c.founder,
    listedAt: Number(c.createdAt) * 1000,
    phase: c.phase === Phase.Raising ? 'raising' : live ? 'live' : 'wound_down',
    heartbeat: red ? 'red' : 'green',
    // One on-chain "month" stands for 30 days, so the wind-down wait shows as 60 days.
    redDays: Math.min(WINDDOWN_DAYS, Math.floor((redSeconds / month) * 30)),
    lastBeat: Number(c.lastBeat) * 1000,
    beats: profile.beats.map(() => (red ? 0 : 1)),
    raiseTarget,
    raised,
    salePrice,
    backers: 0,
    poolUsdc,
    poolTokens,
    circulating: c.phase === Phase.Raising ? ui(c.tokensSold) : ui(balance.supply - (live ? locked : 0n)),
    treasury: ui(balance.treasury),
    treasuryReleased: live ? Math.max(0, raised * (1 - GRADUATION_FEE) * TREASURY_SHARE - ui(balance.treasury)) : 0,
    monthlyBudget: ui(c.monthlyBudget),
    treasuryClaimedThisMonth: BigInt(period) > c.lastTreasuryPeriod ? 0 : ui(c.treasuryClaimedThisPeriod),
    feeVault: ui(balance.feeVault),
    feeCap: ui(c.feeCap),
    feesClaimedThisMonth: BigInt(period) > c.lastFeePeriod ? 0 : ui(c.feesClaimedThisPeriod),
    feesClaimedTotal: 0,
    holderReserve: ui(balance.reserve),
    vestMonths: Math.max(0, Math.floor(greenSeconds / month)),
    founderClaimed: ui(c.founderClaimed),
    founderBurned: c.phase === Phase.WoundDown,
    volume24h: 0,
    volumeTotal: 0,
    history: [salePrice, current],
    openPrice24h: current,
    refundPool: ui(balance.refund),
    refundPerToken,
    woundDownAt: undefined,
    liveAt: live ? Number(c.liveAt) * 1000 : undefined,
    periodSeconds: month,
  }
}

export interface Snapshot {
  startups: Startup[]
  usdc: number
  holdings: Record<string, Holding>
}

/** Every startup on-chain plus, when a wallet is connected, its USDC and token balances. */
export async function loadChain(owner: Address | null, previous: Record<string, Holding>): Promise<Snapshot> {
  const { config } = await getCtx()
  const accounts = await rpc
    .getProgramAccounts(OBVERSE_PROGRAM_ADDRESS, {
      encoding: 'base64',
      filters: [
        { memcmp: { offset: 0n, encoding: 'base58', bytes: getBase58Decoder().decode(STARTUP_DISCRIMINATOR) as Base58EncodedBytes } },
      ],
    })
    .send()
  const decoder = getStartupDecoder()
  const chain = accounts.map(a => ({ address: a.pubkey, data: decoder.decode(bytes(a.account.data[0])) }))
  const vaults = await Promise.all(chain.map(c => vaultsOf(c.address)))
  // One batched read: each startup's mint supply and eight vault balances.
  const supplies = await amounts(vaults.map(v => v[0]), 36)
  const balances = await amounts(vaults.flatMap(v => v.slice(1)))

  const startups = chain.map((c, i) => {
    const [treasury, feeVault, reserve, poolUsdc, poolToken, refund, founderLock, platformLock] = balances.slice(i * 8, i * 8 + 8)
    const s = toStartup(
      c.data,
      config,
      { supply: supplies[i], treasury, feeVault, reserve, poolUsdc, poolToken, refund, founderLock, platformLock },
      owner,
    )
    refs.set(s.id, { startup: c.address, mint: c.data.mint })
    return s
  })
  startups.sort((a, b) => b.raised - a.raised)
  if (!owner) return { startups, usdc: 0, holdings: {} }

  const tokenAccounts = await Promise.all([config.usdcMint, ...chain.map(c => c.data.mint)].map(mint => ata(owner, mint)))
  const [usdc, ...held] = await amounts(tokenAccounts)
  const holdings: Record<string, Holding> = {}
  chain.forEach((c, i) => {
    const s = startups.find(x => x.ticker === c.data.ticker)!
    const tokens = ui(held[i])
    if (tokens <= 0) return
    // Cost basis comes from the indexer in Phase 8. Until then: keep what this browser has seen,
    // and value anything new at the current price.
    const before = previous[s.id]
    const price = s.history[s.history.length - 1]
    const cost = !before
      ? tokens * price
      : tokens <= before.tokens
        ? before.cost * (tokens / before.tokens)
        : before.cost + (tokens - before.tokens) * price
    holdings[s.id] = { tokens, cost }
  })
  return { startups, usdc: ui(usdc), holdings }
}

/** Exact token balance in base units, for "sell all" and refunds. */
export const exactBalance = async (owner: Address, mint: Address) => (await amounts([await ata(owner, mint)]))[0]
