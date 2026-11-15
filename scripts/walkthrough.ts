// The whole product in one run, through the real API and the devnet program, with no browser:
// apply, verify, approve, raise, trade, claim, go silent, wind down, refund.
// Needs the server running with DOMAIN_MODE=mock and the deploy wallet in ADMIN_WALLETS.
// Takes about 12 minutes, most of it the wind-down wait.   npm run walkthrough
import { type KeyPairSigner } from '@solana/kit'

import {
  fetchConfig,
  fetchStartup,
  findMintPda,
  findStartupAddress,
  getBuyInstructionAsync,
  getClaimRefundInstructionAsync,
  getClaimTreasuryInstructionAsync,
  getCommitInstructionAsync,
  getPayVerificationFeeInstructionAsync,
  getWindDownInstructionAsync,
  Heartbeat,
  Phase,
} from '../sdk/src/index.ts'
import { addresses, admin, ata, createAta, faucet, fmt, fundSol, rpc, send, sleep, tokenBalance, USDC, wallet } from './lib.ts'

const API = process.env.API_URL || 'http://127.0.0.1:8787'
const step = (n: number, text: string) => console.log(`\n${n}. ${text}`)
function check(condition: unknown, what: string): asserts condition {
  if (!condition) throw new Error(`Walkthrough failed: ${what}`)
  console.log(`  ok  ${what}`)
}

/** A signed-in API session for one wallet. */
async function session(signer: KeyPairSigner) {
  let cookie = ''
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(API + path, {
      method,
      headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]!
    const data = (await res.json()) as T & { message?: string }
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.message ?? ''}`)
    return data
  }
  const { message } = await call<{ message: string }>('POST', '/auth/nonce', { address: signer.address })
  const [signed] = await signer.signMessages([{ content: new TextEncoder().encode(message), signatures: {} }])
  await call('POST', '/auth/verify', { address: signer.address, signature: Buffer.from(signed![signer.address]!).toString('base64') })
  return call
}

const deployer = await admin()
const [founder, alice, bob] = [await wallet('founder'), await wallet('buyer'), await wallet('holder')]
const { config, usdcMint } = await addresses()
const { platformWallet, winddownSeconds } = (await fetchConfig(rpc, config)).data
const platformUsdc = await ata(platformWallet, usdcMint)
for (const w of [founder, alice, bob]) await fundSol(deployer, w.address, 0.2)

// A fresh random ticker each run, so two runs in a row never collide.
const ticker = Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')
const form = {
  founderName: 'Walkthrough Founder', founderRole: 'CEO', country: 'Pakistan', email: 'founder@example.com', name: `Walkthrough ${ticker}`, ticker,
  tagline: 'A startup created by the scripted walkthrough', about: 'It lives for about twelve minutes.', category: 'Other',
  website: 'example.com', github: 'solana-foundation/anchor', social: '@walkthrough', raiseTarget: 10_000, monthlyBudget: 1_000, feeCap: 100,
}

step(1, `Apply for ${ticker}: draft, four checks, verification fee`)
const asFounder = await session(founder)
const draft = await asFounder<{ id: string; code: string }>('PUT', '/applications/draft', form)
for (const key of ['kyc', 'domain', 'github', 'socials']) {
  const { check: result } = await asFounder<{ check: { status: string; detail: string } }>('POST', `/applications/${draft.id}/verify/${key}`)
  check(result.status === 'passed', `${key} check passed (${result.detail})`)
}
await faucet(founder, usdcMint, 300n * USDC)
const feeSignature = await send('pay_verification_fee', founder, [
  await getPayVerificationFeeInstructionAsync({ founder, usdcMint, founderUsdc: await ata(founder.address, usdcMint), platformUsdc, applicationId: draft.id }),
])
const submitted = await asFounder<{ status: string }>('POST', '/applications', { ...form, id: draft.id, feeSignature })
check(submitted.status === 'submitted', 'application accepted after the server verified the fee payment')

step(2, 'Admin review: run the checks, then list now')
const asAdmin = await session(deployer)
await asAdmin('POST', `/admin/applications/${draft.id}/run-checks`)
const listed = await asAdmin<{ status: string }>('POST', `/admin/applications/${draft.id}/list-now`)
check(listed.status === 'listed', 'the operator listed the startup on-chain')
const startup = await findStartupAddress(ticker)
const [mint] = await findMintPda({ startup })
const state = async () => (await fetchStartup(rpc, startup)).data
check((await state()).phase === Phase.Raising, 'the raise is open')

step(3, 'Two buyers fill the raise; it closes itself at the target')
const commit = async (buyer: KeyPairSigner, usdcIn: bigint) => {
  await faucet(buyer, usdcMint, usdcIn)
  await send(`commit ${fmt(usdcIn)} USDC`, buyer, [
    await createAta(buyer, buyer.address, mint),
    await getCommitInstructionAsync({ buyer, startup, usdcMint, mint, buyerUsdc: await ata(buyer.address, usdcMint), buyerToken: await ata(buyer.address, mint), platformUsdc, usdcIn }),
  ])
}
await commit(alice, 4_000n * USDC)
await commit(bob, 6_000n * USDC)
check((await state()).phase === Phase.Live, 'trading is open')

step(4, 'Trade on the pool')
await faucet(alice, usdcMint, 200n * USDC)
await send('buy with 200 USDC', alice, [
  await getBuyInstructionAsync({ trader: alice, startup, usdcMint, mint, traderUsdc: await ata(alice.address, usdcMint), traderToken: await ata(alice.address, mint), platformUsdc, usdcIn: 200n * USDC, minTokensOut: 0 }),
])

step(5, 'The founder posts an update and claims this month\'s budget')
await asFounder('POST', `/startups/${ticker}/updates`, { body: 'The walkthrough startup shipped its first release this month.' })
await send('claim_treasury', founder, [
  await getClaimTreasuryInstructionAsync({ founder, startup, usdcMint, founderUsdc: await ata(founder.address, usdcMint) }),
])

step(6, 'The indexer has every trade')
let trades: { side: string }[] = []
// A fresh database first backfills every earlier program transaction, so allow a few minutes.
for (let i = 0; i < 60 && trades.length < 3; i++) {
  await sleep(5_000)
  trades = await asFounder('GET', `/startups/${ticker}/trades`)
}
check(trades.filter(t => t.side === 'commit').length === 2 && trades.filter(t => t.side === 'buy').length === 1, 'two commits and one buy are indexed')
const profile = await asFounder<{ backers: number; updates: unknown[] }>('GET', `/startups/${ticker}`)
check(profile.backers === 2 && profile.updates.length === 1, 'the public profile shows 2 backers and the founder update')

step(7, 'The startup goes silent: an admin marks it, with a reason')
await asAdmin('POST', `/admin/startups/${ticker}/heartbeat`, { status: 'red', reason: 'Scripted walkthrough: simulating a silent startup' })
check((await state()).heartbeat === Heartbeat.Red, 'the heartbeat is red on-chain')
let refused = false
try {
  await send('claim_treasury while red', founder, [
    await getClaimTreasuryInstructionAsync({ founder, startup, usdcMint, founderUsdc: await ata(founder.address, usdcMint) }),
  ])
} catch {
  refused = true
}
check(refused, 'a payout while red is rejected by the program')

const waitMs = (Number((await state()).redSince + winddownSeconds) - Date.now() / 1000 + 15) * 1000
step(8, `Waiting ${Math.ceil(waitMs / 1000)}s of silence (the devnet stand-in for 60 days)`)
await sleep(Math.max(0, waitMs))

step(9, 'Anyone winds the startup down; holders are refunded')
await send('wind_down', bob, [await getWindDownInstructionAsync({ caller: bob, startup, usdcMint, mint })])
const wound = await state()
check(wound.phase === Phase.WoundDown, `wound down with ${fmt(wound.refundPool)} USDC to refund`)
let refunded = 0n
for (const holder of [alice, bob]) {
  const holderToken = await ata(holder.address, mint)
  const holderUsdc = await ata(holder.address, usdcMint)
  const [amount, before] = [await tokenBalance(holderToken), await tokenBalance(holderUsdc)]
  await send(`claim_refund for ${fmt(amount)} tokens`, holder, [
    await getClaimRefundInstructionAsync({ holder, startup, usdcMint, mint, holderToken, holderUsdc, amount }),
  ])
  refunded += (await tokenBalance(holderUsdc)) - before
}
check(wound.refundPool - refunded < 5n, `holders received ${fmt(refunded)} USDC, all but rounding dust`)
console.log(`\nWalkthrough complete for ${ticker}.`)
