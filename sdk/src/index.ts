// The generated program client (Codama, from the Anchor IDL) plus the types shared by app/ and server/.
// Regenerate with `npm run generate` after `anchor build`.
import { type Address, getProgramDerivedAddress } from '@solana/kit'

import { OBVERSE_PROGRAM_ADDRESS } from './generated/index.ts'

export * from './generated/index.ts'

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
