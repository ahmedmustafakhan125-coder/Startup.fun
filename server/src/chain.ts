// Everything the backend does on devnet: verifying a founder's fee payment and sending the
// operator's transactions. Routes and jobs take this interface, so tests swap in a fake.
import { readFileSync } from 'node:fs'
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { type Address, address, createKeyPairSignerFromBytes, type Signature } from '@solana/kit'
import {
  APPLICATION_FEE_PAID_EVENT_DISCRIMINATOR,
  createRpc,
  fetchConfig,
  findConfigPda,
  findMintPda,
  findStartupAddress,
  getApplicationFeePaidEventDecoder,
  getCloseRaiseInstructionAsync,
  listStartupInstructions,
  OBVERSE_PROGRAM_ADDRESS,
  programEvents,
  sendAndConfirm,
} from '../../sdk/src/index.ts'
import type { Env } from './env.ts'

export interface ListArgs {
  ticker: string
  founder: string
  /** Whole USDC. */
  raiseTarget: number
  monthlyBudget: number
  feeCap: number
}

export interface Chain {
  /** Null when `signature` is a confirmed payment of the verification fee for this application by this wallet; otherwise why not. */
  verifyFee(signature: string, applicationId: string, payer: string): Promise<string | null>
  listStartup(args: ListArgs): Promise<{ signature: string; address: string; mint: string }>
  closeRaise(ticker: string): Promise<string>
}

const USDC = 1_000_000n
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const hasPrefix = (data: Uint8Array, prefix: ArrayLike<number>) => Array.prototype.every.call(prefix, (b: number, i: number) => data[i] === b)

export async function createChain(env: Env): Promise<Chain> {
  if (env.programId && env.programId !== OBVERSE_PROGRAM_ADDRESS)
    throw new Error('PROGRAM_ID does not match the generated client. Run `npm run generate` in sdk/.')
  const rpc = createRpc(env.rpcUrl)
  if (!env.operatorKeypairPath) throw new Error('OPERATOR_KEYPAIR_PATH is not set.')
  const operator = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(env.operatorKeypairPath, 'utf8'))))
  const config = (await fetchConfig(rpc, (await findConfigPda())[0])).data
  if (config.operator !== operator.address) throw new Error('The operator key is not the operator in the on-chain config.')
  const [platformUsdc] = await findAssociatedTokenPda({ owner: config.platformWallet, mint: config.usdcMint, tokenProgram: TOKEN_PROGRAM_ADDRESS })

  return {
    async verifyFee(signature, applicationId, payer) {
      let tx = null
      // A transaction the wallet just confirmed can take a moment to be readable.
      for (let attempt = 0; attempt < 5 && !tx; attempt++) {
        if (attempt) await sleep(2_000)
        try {
          tx = await rpc.getTransaction(signature as Signature, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 0 }).send()
        } catch {
          return 'That is not a transaction signature.'
        }
      }
      if (!tx) return 'The fee payment was not found on devnet.'
      if (tx.meta?.err) return 'The fee payment failed on-chain.'
      const decoder = getApplicationFeePaidEventDecoder()
      for (const data of programEvents(tx.meta?.logMessages ?? [])) {
        if (!hasPrefix(data, APPLICATION_FEE_PAID_EVENT_DISCRIMINATOR)) continue
        const event = decoder.decode(data)
        if (event.applicationId === applicationId && event.payer === payer && event.amount >= config.verificationFee) return null
      }
      return 'That transaction does not pay the verification fee for this application.'
    },

    async listStartup(args) {
      const signature = await sendAndConfirm(
        rpc,
        operator,
        await listStartupInstructions(operator, config.usdcMint, {
          ticker: args.ticker,
          founder: address(args.founder),
          raiseTarget: BigInt(args.raiseTarget) * USDC,
          monthlyBudget: BigInt(args.monthlyBudget) * USDC,
          feeCap: BigInt(args.feeCap) * USDC,
        }),
        400_000,
      )
      const startup = await findStartupAddress(args.ticker)
      return { signature, address: startup, mint: (await findMintPda({ startup }))[0] }
    },

    async closeRaise(ticker) {
      const startup: Address = await findStartupAddress(ticker)
      const [mint] = await findMintPda({ startup })
      return sendAndConfirm(rpc, operator, [
        await getCloseRaiseInstructionAsync({ operator, startup, usdcMint: config.usdcMint, mint, platformUsdc }),
      ])
    },
  }
}
