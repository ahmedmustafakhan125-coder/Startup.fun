import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget'
import {
  appendTransactionMessageInstructions,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Instruction,
  type KeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** A devnet RPC client that backs off on HTTP 429. The public endpoint rate-limits per IP. */
export function createRpc(url: string) {
  // Hard rule: devnet only.
  if (/mainnet/i.test(url)) throw new Error('The RPC URL points at mainnet. Obverse runs on devnet only.')
  const transport = createDefaultRpcTransport({ url })
  return createSolanaRpcFromTransport((async (...args: Parameters<typeof transport>) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transport(...args)
      } catch (error) {
        if (attempt >= 6 || !String(error).includes('429')) throw error
        await sleep(3_000 * (attempt + 1))
      }
    }
  }) as typeof transport)
}

export type Rpc = ReturnType<typeof createRpc>

/**
 * Signs with the instructions' signers, sends one transaction and waits until it is confirmed.
 * Polls instead of subscribing: fewer moving parts on the public devnet endpoint.
 */
export async function sendAndConfirm(rpc: Rpc, payer: KeyPairSigner, instructions: Instruction[], units?: number): Promise<string> {
  const { value: blockhash } = await rpc.getLatestBlockhash().send()
  const all = units ? [getSetComputeUnitLimitInstruction({ units }), ...instructions] : instructions
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayerSigner(payer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    m => appendTransactionMessageInstructions(all, m),
  )
  const tx = await signTransactionMessageWithSigners(message)
  const signature = getSignatureFromTransaction(tx)
  await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: 'base64' }).send()
  for (let i = 0; i < 45; i++) {
    await sleep(2_000)
    const status = (await rpc.getSignatureStatuses([signature]).send()).value[0]
    if (status?.err) throw new Error(`Transaction ${signature} failed`)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature
  }
  throw new Error(`Transaction ${signature} was not confirmed in time`)
}
