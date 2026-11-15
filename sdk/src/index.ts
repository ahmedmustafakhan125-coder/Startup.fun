// The generated program client (Codama, from the Anchor IDL) plus the types shared by app/ and server/.
// Regenerate with `npm run generate` after `anchor build`.
import { type Address, getProgramDerivedAddress, type Instruction, type TransactionSigner } from '@solana/kit'

import {
  getCreateStartupInstructionAsync,
  getCreateStartupVaultsInstructionAsync,
  OBVERSE_PROGRAM_ADDRESS,
} from './generated/index.ts'

export * from './generated/index.ts'
export * from './events.ts'
export * from './rpc.ts'

/** The only cluster this project targets. */
export const CLUSTER = 'devnet' as const
export type Cluster = typeof CLUSTER

/** Lifecycle of a startup, matching app/src/store/types.ts. */
export type StartupPhase = 'raising' | 'live' | 'wound_down'

/** A startup's account address. Its other accounts derive from it (see the generated `find*Pda`). */
export async function findStartupAddress(ticker: string): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: OBVERSE_PROGRAM_ADDRESS,
    seeds: ['startup', ticker],
  })
  return address
}

/** Both listing instructions, to be sent in one transaction with a 400,000 compute unit limit. */
export async function listStartupInstructions(
  operator: TransactionSigner,
  usdcMint: Address,
  args: { ticker: string; founder: Address; raiseTarget: bigint; monthlyBudget: bigint; feeCap: bigint },
): Promise<Instruction[]> {
  const startup = await findStartupAddress(args.ticker)
  return [
    await getCreateStartupInstructionAsync({ operator, startup, ...args }),
    await getCreateStartupVaultsInstructionAsync({ operator, usdcMint, startup }),
  ]
}
