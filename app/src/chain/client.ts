// Devnet connection and wallet signing for live mode. Mock mode never calls into this file.
import {
  type Address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64Decoder,
  getTransactionEncoder,
  type Instruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { getWallets } from '@wallet-standard/app'
import { create } from 'zustand'
import { createRpc, OBVERSE_PROGRAM_ADDRESS } from '../../../sdk/src/index.ts'

export const LIVE = import.meta.env.VITE_DATA_SOURCE === 'live'

const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://api.devnet.solana.com'
if (LIVE && import.meta.env.VITE_PROGRAM_ID && import.meta.env.VITE_PROGRAM_ID !== OBVERSE_PROGRAM_ADDRESS)
  throw new Error('VITE_PROGRAM_ID does not match the generated client. Run `npm run generate` in sdk/.')

export const rpc = createRpc(RPC_URL)
export const explorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`

/** Where the transaction in flight is, so buttons can say so. */
export type TxStage = 'wallet' | 'confirming' | null
export const useTxStage = create<{ stage: TxStage }>(() => ({ stage: null }))
export const stageLabel = (stage: TxStage) => (stage === 'wallet' ? 'Waiting for wallet' : 'Confirming')

/** An error whose message is already written for the user. */
export class UserError extends Error {}

// The two Wallet Standard features used here, typed just enough for this file.
interface StandardAccount {
  address: string
}
interface SignTransactionFeature {
  signTransaction(input: {
    account: StandardAccount
    transaction: Uint8Array
    chain: 'solana:devnet'
  }): Promise<readonly { signedTransaction: Uint8Array }[]>
}
interface ConnectFeature {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StandardAccount[] }>
}

/** Finds the installed wallet that holds `owner` and can sign Solana transactions. */
async function walletFor(owner: string) {
  for (const wallet of getWallets().get()) {
    const features = wallet.features as Record<string, unknown>
    const sign = features['solana:signTransaction'] as SignTransactionFeature | undefined
    if (!sign) continue
    let account: StandardAccount | undefined = wallet.accounts.find(a => a.address === owner)
    const connect = features['standard:connect'] as ConnectFeature | undefined
    // After a page reload the wallet is still authorised but lists no accounts until asked.
    if (!account && connect) account = (await connect.connect({ silent: true })).accounts.find(a => a.address === owner)
    if (account) return { sign, account }
  }
  throw new UserError('Your wallet is not available. Reconnect it and try again.')
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Has the wallet sign one transaction, sends it to devnet and waits until it is confirmed. */
export async function sendWithWallet(owner: Address, instructions: Instruction[]): Promise<string> {
  try {
    useTxStage.setState({ stage: 'wallet' })
    const { sign, account } = await walletFor(owner)
    const { value: blockhash } = await rpc.getLatestBlockhash().send()
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      m => setTransactionMessageFeePayer(owner, m),
      m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      m => appendTransactionMessageInstructions(instructions, m),
    )
    const unsigned = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)))
    const [{ signedTransaction }] = await sign.signTransaction({ account, transaction: unsigned, chain: 'solana:devnet' })

    useTxStage.setState({ stage: 'confirming' })
    const wire = getBase64Decoder().decode(signedTransaction) as Parameters<typeof rpc.sendTransaction>[0]
    const signature = await rpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' }).send()
    for (let i = 0; i < 45; i++) {
      await sleep(1_500)
      const status = (await rpc.getSignatureStatuses([signature]).send()).value[0]
      if (status?.err) throw status.err
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature
    }
    throw new UserError('The network did not confirm the transaction in time. Check your wallet before trying again.')
  } finally {
    useTxStage.setState({ stage: null })
  }
}
