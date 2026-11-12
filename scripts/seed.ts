// Puts the sample startups from app/src/data/seed.ts on devnet so every lifecycle state exists:
// raising, live and green, live and red, wound down. Safe to run again: listed tickers are skipped.
//   npm run seed        (run `npm run init` first)
import { type Address, type KeyPairSigner } from '@solana/kit'

import {
  fetchConfig,
  fetchStartup,
  getBuyInstructionAsync,
  getCommitInstructionAsync,
  getReportHeartbeatInstructionAsync,
  getSellInstructionAsync,
  getWindDownInstructionAsync,
  Heartbeat,
  Phase,
} from '../sdk/src/index.ts'
import { addresses, admin, ata, createAta, faucet, fmt, fundSol, list, rpc, send, sleep, TOKENS, USDC, wallet } from './lib.ts'

type State = 'raising' | 'live' | 'red' | 'wound_down'
// Ticker, raise target, amount raised, monthly budget and fee cap (whole USDC), copied from app/src/data/seed.ts.
const SAMPLES: [string, number, number, number, number, State][] = [
  ['NRTH', 240_000, 240_000, 14_000, 2_500, 'live'],
  ['TALY', 120_000, 120_000, 9_000, 1_500, 'live'],
  ['LUMN', 180_000, 180_000, 12_000, 2_000, 'live'],
  ['QUIL', 90_000, 90_000, 6_000, 1_000, 'live'],
  ['FERN', 150_000, 150_000, 10_000, 1_500, 'red'],
  ['MOSS', 160_000, 99_200, 11_000, 1_500, 'raising'],
  ['HRBR', 300_000, 54_000, 18_000, 3_000, 'raising'],
  ['DRFT', 80_000, 80_000, 7_000, 1_000, 'wound_down'],
]

const deployer = await admin()
const [operator, founder, buyer] = [await wallet('operator'), await wallet('founder'), await wallet('buyer')]
const { config, usdcMint } = await addresses()
const { platformWallet, winddownSeconds } = (await fetchConfig(rpc, config)).data
const platformUsdc = await ata(platformWallet, usdcMint)
await fundSol(deployer, operator.address, 1)
await fundSol(deployer, buyer.address, 0.3)

async function trade(startup: Address, mint: Address, trader: KeyPairSigner, usdcIn: bigint) {
  const accounts = {
    trader,
    startup,
    usdcMint,
    mint,
    traderUsdc: await ata(trader.address, usdcMint),
    traderToken: await ata(trader.address, mint),
    platformUsdc,
  }
  await faucet(trader, usdcMint, usdcIn)
  await send(`buy with ${fmt(usdcIn)} USDC`, trader, [
    await getBuyInstructionAsync({ ...accounts, usdcIn, minTokensOut: 0 }),
  ])
  await send('sell 10,000 tokens', trader, [
    await getSellInstructionAsync({ ...accounts, tokensIn: 10_000n * TOKENS, minUsdcOut: 0 }),
  ])
}

const heartbeat = async (startup: Address, status: Heartbeat) =>
  send(`heartbeat ${Heartbeat[status]}`, operator, [await getReportHeartbeatInstructionAsync({ operator, startup, status })])

let toWindDown: { startup: Address; mint: Address } | undefined
for (const [ticker, target, raised, monthlyBudget, feeCap, state] of SAMPLES) {
  console.log(`\n${ticker}: ${state}`)
  const { startup, mint, created } = await list(operator, usdcMint, {
    ticker,
    founder: founder.address,
    raiseTarget: BigInt(target) * USDC,
    monthlyBudget: BigInt(monthlyBudget) * USDC,
    feeCap: BigInt(feeCap) * USDC,
  })
  if (state === 'wound_down') toWindDown = { startup, mint }
  if (!created) {
    console.log('  already listed, skipping')
    continue
  }
  const usdcIn = BigInt(raised * 100) * (USDC / 100n)
  await faucet(buyer, usdcMint, usdcIn)
  await send(`commit ${fmt(usdcIn)} USDC`, buyer, [
    await createAta(buyer, buyer.address, mint),
    await getCommitInstructionAsync({
      buyer,
      startup,
      usdcMint,
      mint,
      buyerUsdc: await ata(buyer.address, usdcMint),
      buyerToken: await ata(buyer.address, mint),
      platformUsdc,
      usdcIn,
    }),
  ])
  if (state === 'raising') continue
  await trade(startup, mint, buyer, BigInt(Math.round(raised / 100)) * USDC)
  if (state === 'red' || state === 'wound_down') await heartbeat(startup, Heartbeat.Red)
}

if (toWindDown) {
  const { startup, mint } = toWindDown
  let s = (await fetchStartup(rpc, startup)).data
  if (s.phase === Phase.Live) {
    if (s.heartbeat === Heartbeat.Green) await heartbeat(startup, Heartbeat.Red)
    s = (await fetchStartup(rpc, startup)).data
    const waitMs = (Number(s.redSince + winddownSeconds) - Date.now() / 1000 + 15) * 1000
    if (waitMs > 0) {
      console.log(`\nDRFT: waiting ${Math.ceil(waitMs / 1000)}s for the wind-down wait to pass...`)
      await sleep(waitMs)
    }
    await send('wind_down DRFT', deployer, [await getWindDownInstructionAsync({ caller: deployer, startup, usdcMint, mint })])
  }
}
console.log('\nSeed complete.')
