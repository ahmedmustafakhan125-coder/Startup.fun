// Transaction builders for live mode: one function per money action, returning instructions for the
// wallet to sign. Each one first makes sure the token accounts it pays into exist.
import { getCreateAssociatedTokenIdempotentInstructionAsync } from '@solana-program/token'
import { type Address, createNoopSigner, type Instruction } from '@solana/kit'
import {
  getBuyInstructionAsync,
  getClaimFeesInstructionAsync,
  getClaimFounderTokensInstructionAsync,
  getClaimRefundInstructionAsync,
  getClaimTreasuryInstructionAsync,
  getCommitInstructionAsync,
  getFaucetInstructionAsync,
  getSellInstructionAsync,
} from '../../../sdk/src/index.ts'
import { ata, getCtx, type Ref } from './read'

/** Display units to base units (6 decimals). */
export const toBase = (amount: number) => BigInt(Math.round(amount * 1e6))

// The wallet signs the whole transaction, so instructions only need to carry its address.
const signer = (owner: Address) => createNoopSigner(owner)
const ensureAta = (owner: Address, mint: Address) =>
  getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer(owner), owner, mint })

export async function faucetTx(owner: Address, amount: bigint): Promise<Instruction[]> {
  const { usdcMint } = (await getCtx()).config
  return [
    await ensureAta(owner, usdcMint),
    await getFaucetInstructionAsync({ user: signer(owner), usdcMint, userUsdc: await ata(owner, usdcMint), amount }),
  ]
}

export async function commitTx(owner: Address, { startup, mint }: Ref, usdcIn: bigint): Promise<Instruction[]> {
  const { config, platformUsdc } = await getCtx()
  return [
    await ensureAta(owner, mint),
    await getCommitInstructionAsync({
      buyer: signer(owner),
      startup,
      usdcMint: config.usdcMint,
      mint,
      buyerUsdc: await ata(owner, config.usdcMint),
      buyerToken: await ata(owner, mint),
      platformUsdc,
      usdcIn,
    }),
  ]
}

async function tradeAccounts(owner: Address, { startup, mint }: Ref) {
  const { config, platformUsdc } = await getCtx()
  return {
    trader: signer(owner),
    startup,
    usdcMint: config.usdcMint,
    mint,
    traderUsdc: await ata(owner, config.usdcMint),
    traderToken: await ata(owner, mint),
    platformUsdc,
  }
}

export async function buyTx(owner: Address, ref: Ref, usdcIn: bigint, minTokensOut: bigint): Promise<Instruction[]> {
  return [
    await ensureAta(owner, ref.mint),
    await getBuyInstructionAsync({ ...(await tradeAccounts(owner, ref)), usdcIn, minTokensOut }),
  ]
}

export async function sellTx(owner: Address, ref: Ref, tokensIn: bigint, minUsdcOut: bigint): Promise<Instruction[]> {
  const accounts = await tradeAccounts(owner, ref)
  return [
    await ensureAta(owner, accounts.usdcMint),
    await getSellInstructionAsync({ ...accounts, tokensIn, minUsdcOut }),
  ]
}

async function founderUsdcAccounts(owner: Address, { startup }: Ref) {
  const { usdcMint } = (await getCtx()).config
  return { founder: signer(owner), startup, usdcMint, founderUsdc: await ata(owner, usdcMint) }
}

export async function claimTreasuryTx(owner: Address, ref: Ref): Promise<Instruction[]> {
  const accounts = await founderUsdcAccounts(owner, ref)
  return [await ensureAta(owner, accounts.usdcMint), await getClaimTreasuryInstructionAsync(accounts)]
}

export async function claimFeesTx(owner: Address, ref: Ref): Promise<Instruction[]> {
  const accounts = await founderUsdcAccounts(owner, ref)
  return [await ensureAta(owner, accounts.usdcMint), await getClaimFeesInstructionAsync(accounts)]
}

export async function claimFounderTokensTx(owner: Address, { startup, mint }: Ref): Promise<Instruction[]> {
  return [
    await ensureAta(owner, mint),
    await getClaimFounderTokensInstructionAsync({
      founder: signer(owner),
      startup,
      mint,
      founderToken: await ata(owner, mint),
    }),
  ]
}

export async function claimRefundTx(owner: Address, { startup, mint }: Ref, amount: bigint): Promise<Instruction[]> {
  const { usdcMint } = (await getCtx()).config
  return [
    await ensureAta(owner, usdcMint),
    await getClaimRefundInstructionAsync({
      holder: signer(owner),
      startup,
      usdcMint,
      mint,
      holderToken: await ata(owner, mint),
      holderUsdc: await ata(owner, usdcMint),
      amount,
    }),
  ]
}
