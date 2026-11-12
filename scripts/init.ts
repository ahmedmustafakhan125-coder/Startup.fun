// Creates the program config on devnet: demo USDC mint, infra vault, operator key, devnet timing.
// Safe to run again: it skips what already exists.   npm run init
import { type Address } from '@solana/kit'

import { fetchMaybeConfig, getInitializeConfigInstructionAsync } from '../sdk/src/index.ts'
import { addresses, admin, createAta, explorer, fundSol, rpc, send, wallet } from './lib.ts'

const MONTH_SECONDS = 300 // five minutes stand in for a month on devnet
const WINDDOWN_SECONDS = 600

const deployer = await admin()
const operator = await wallet('operator')
const platformWallet = (process.env.PLATFORM_WALLET as Address | undefined) ?? deployer.address
const { program, config, usdcMint } = await addresses()

if ((await fetchMaybeConfig(rpc, config)).exists) {
  console.log('Config already exists, skipping initialize_config.')
} else {
  await send('initialize_config', deployer, [
    await getInitializeConfigInstructionAsync({
      deployer,
      operator: operator.address,
      platformWallet,
      monthSeconds: MONTH_SECONDS,
      winddownSeconds: WINDDOWN_SECONDS,
    }),
  ])
}
await fundSol(deployer, operator.address, 1)
await send('platform USDC account', deployer, [await createAta(deployer, platformWallet, usdcMint)])

console.log(`
Program ID   ${program}
Config       ${config}
Demo USDC    ${usdcMint}
Admin        ${deployer.address}
Operator     ${operator.address}   (key file: keypairs/operator.json, git-ignored)
Platform     ${platformWallet}
${explorer('address', program)}`)
