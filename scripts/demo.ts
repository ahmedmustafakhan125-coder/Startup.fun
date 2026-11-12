// Walks one new startup through its whole life on devnet and prints an explorer link per step:
// list, raise, trade, treasury claim, red heartbeat, wind-down, refunds. Takes about 11 minutes,
// most of it the wind-down wait.   npm run demo        (run `npm run init` first)
import { type KeyPairSigner } from '@solana/kit'

import {
  fetchConfig,
  fetchStartup,
  getBuyInstructionAsync,
  getClaimRefundInstructionAsync,
  getClaimTreasuryInstructionAsync,
  getCommitInstructionAsync,
  getReportHeartbeatInstructionAsync,
  getWindDownInstructionAsync,
  Heartbeat,
} from '../sdk/src/index.ts'
import { addresses, admin, ata, createAta, explorer, faucet, fmt, fundSol, list, rpc, send, sleep, tokenBalance, USDC, wallet } from './lib.ts'

const deployer = await admin()
const [operator, founder, alice, bob] = [
  await wallet('operator'),
  await wallet('founder'),
  await wallet('buyer'),
  await wallet('holder'),
]
const { config, usdcMint } = await addresses()
const { platformWallet, winddownSeconds } = (await fetchConfig(rpc, config)).data
const platformUsdc = await ata(platformWallet, usdcMint)
for (const w of [operator, founder, alice, bob]) await fundSol(deployer, w.address, 0.2)

// A fresh random ticker each run, so the demo never collides with an earlier one.
const ticker = Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')
console.log(`\n1. List ${ticker} with a 1,000 USDC raise`)
const { startup, mint } = await list(operator, usdcMint, {
  ticker,
  founder: founder.address,
  raiseTarget: 1_000n * USDC,
  monthlyBudget: 100n * USDC,
  feeCap: 10n * USDC,
})
console.log(`      ${explorer('address', startup)}`)

const commit = async (buyer: KeyPairSigner, usdcIn: bigint) => {
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
}
console.log('\n2. Two buyers fill the raise; it closes itself at the target')
await commit(alice, 400n * USDC)
await commit(bob, 600n * USDC)

console.log('\n3. Trade on the pool')
await faucet(alice, usdcMint, 50n * USDC)
await send('buy with 50 USDC', alice, [
  await getBuyInstructionAsync({
    trader: alice,
    startup,
    usdcMint,
    mint,
    traderUsdc: await ata(alice.address, usdcMint),
    traderToken: await ata(alice.address, mint),
    platformUsdc,
    usdcIn: 50n * USDC,
    minTokensOut: 0,
  }),
])

console.log('\n4. The founder claims this month\'s treasury budget')
await send('claim_treasury', founder, [
  await createAta(founder, founder.address, usdcMint),
  await getClaimTreasuryInstructionAsync({
    founder,
    startup,
    usdcMint,
    founderUsdc: await ata(founder.address, usdcMint),
  }),
])

console.log('\n5. The heartbeat goes red')
await send('report_heartbeat Red', operator, [
  await getReportHeartbeatInstructionAsync({ operator, startup, status: Heartbeat.Red }),
])
const { redSince } = (await fetchStartup(rpc, startup)).data
const waitMs = (Number(redSince + winddownSeconds) - Date.now() / 1000 + 15) * 1000
console.log(`\n6. Waiting ${Math.ceil(waitMs / 1000)}s of silence (the devnet stand-in for 60 days)...`)
await sleep(Math.max(0, waitMs))

console.log('\n7. Anyone can now wind the startup down')
await send('wind_down', deployer, [await getWindDownInstructionAsync({ caller: deployer, startup, usdcMint, mint })])
const wound = (await fetchStartup(rpc, startup)).data
console.log(`      refund pool ${fmt(wound.refundPool)} USDC for ${fmt(wound.refundCirculating)} tokens`)

console.log('\n8. Holders burn their tokens for their share')
for (const holder of [alice, bob]) {
  const holderToken = await ata(holder.address, mint)
  const holderUsdc = await ata(holder.address, usdcMint)
  const [amount, before] = [await tokenBalance(holderToken), await tokenBalance(holderUsdc)]
  await send(`claim_refund for ${fmt(amount)} tokens`, holder, [
    await getClaimRefundInstructionAsync({ holder, startup, usdcMint, mint, holderToken, holderUsdc, amount }),
  ])
  console.log(`      received ${fmt((await tokenBalance(holderUsdc)) - before)} USDC`)
}
console.log(`\nDemo complete for ${ticker}.`)
