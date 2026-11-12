// Shared helpers for the devnet scripts: keys, RPC, sending transactions, token accounts.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
import {
  type Address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
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

import {
  createRpc,
  fetchMaybeStartup,
  findConfigPda,
  findMintPda,
  findStartupAddress,
  findUsdcMintPda,
  getCreateStartupInstructionAsync,
  getCreateStartupVaultsInstructionAsync,
  getFaucetInstructionAsync,
  OBVERSE_PROGRAM_ADDRESS,
} from '../sdk/src/index.ts'

export const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com'
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
export const rpc = createRpc(RPC_URL)
export const USDC = 1_000_000n
export const TOKENS = 1_000_000n
export const FAUCET_MAX = 5_000n * USDC
export const KEYS_DIR = new URL('../keypairs/', import.meta.url).pathname // git-ignored

export const explorer = (kind: 'tx' | 'address', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`
export const fmt = (baseUnits: bigint) => (Number(baseUnits) / 1e6).toLocaleString('en-US')

async function loadSigner(path: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, 'utf8'))))
}

/** The deploy wallet. It is the config admin and pays for everything the scripts do. */
export const admin = () =>
  loadSigner(process.env.ADMIN_KEYPAIR_PATH || `${homedir()}/.config/solana/id.json`)

/** A named script wallet under keypairs/, created on first use. Only its public key is ever printed. */
export async function wallet(name: string): Promise<KeyPairSigner> {
  const path = `${KEYS_DIR}${name}.json`
  if (!existsSync(path)) {
    mkdirSync(KEYS_DIR, { recursive: true })
    execFileSync('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '--outfile', path], { stdio: 'ignore' })
  }
  return loadSigner(path)
}

/** Sends one transaction, waits for confirmation, prints an explorer link and returns the signature. */
export async function send(label: string, payer: KeyPairSigner, instructions: Instruction[], units?: number) {
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
  // Poll instead of subscribing: fewer moving parts on the public devnet endpoint.
  for (let i = 0; i < 45; i++) {
    await sleep(2_000)
    const status = (await rpc.getSignatureStatuses([signature]).send()).value[0]
    if (status?.err) throw new Error(`${label} failed: ${explorer('tx', signature)}`)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      console.log(`  ok  ${label}\n      ${explorer('tx', signature)}`)
      return signature
    }
  }
  throw new Error(`${label} was not confirmed in time: ${explorer('tx', signature)}`)
}

export async function ata(owner: Address, mint: Address): Promise<Address> {
  const [address] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS })
  return address
}

export const createAta = (payer: KeyPairSigner, owner: Address, mint: Address) =>
  getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner, mint })

export async function tokenBalance(account: Address): Promise<bigint> {
  const info = await rpc.getAccountInfo(account, { encoding: 'base64' }).send()
  if (!info.value) return 0n
  return Buffer.from(info.value.data[0], 'base64').readBigUInt64LE(64)
}

/** Tops a wallet up to `sol` SOL from the admin wallet. */
export async function fundSol(from: KeyPairSigner, to: Address, sol: number) {
  const want = BigInt(Math.round(sol * 1e9))
  const have = (await rpc.getBalance(to).send()).value
  if (have >= want / 2n) return
  await send(`fund ${to} with SOL`, from, [
    getTransferSolInstruction({ source: from, destination: to, amount: want - have }),
  ])
}

export async function addresses() {
  const [config] = await findConfigPda()
  const [usdcMint] = await findUsdcMintPda()
  return { program: OBVERSE_PROGRAM_ADDRESS, config, usdcMint }
}

/** Gives `user` demo USDC through the faucet, 5,000 per instruction. */
export async function faucet(user: KeyPairSigner, usdcMint: Address, amount: bigint) {
  const userUsdc = await ata(user.address, usdcMint)
  const calls: bigint[] = []
  for (let left = amount; left > 0n; left -= FAUCET_MAX) calls.push(left < FAUCET_MAX ? left : FAUCET_MAX)
  for (let i = 0; i < calls.length; i += 20) {
    const batch = calls.slice(i, i + 20)
    const ixs = await Promise.all(
      batch.map(amount => getFaucetInstructionAsync({ user, usdcMint, userUsdc, amount })),
    )
    const total = batch.reduce((a, b) => a + b, 0n)
    await send(`faucet ${fmt(total)} USDC`, user, [await createAta(user, user.address, usdcMint), ...ixs], 400_000)
  }
}

export interface Listed {
  startup: Address
  mint: Address
  created: boolean
}

/** Lists a startup (both instructions in one transaction). Does nothing if the ticker already exists. */
export async function list(
  operator: KeyPairSigner,
  usdcMint: Address,
  args: { ticker: string; founder: Address; raiseTarget: bigint; monthlyBudget: bigint; feeCap: bigint },
): Promise<Listed> {
  const startup = await findStartupAddress(args.ticker)
  const [mint] = await findMintPda({ startup })
  if ((await fetchMaybeStartup(rpc, startup)).exists) return { startup, mint, created: false }
  await send(
    `list ${args.ticker}`,
    operator,
    [
      await getCreateStartupInstructionAsync({ operator, startup, ...args }),
      await getCreateStartupVaultsInstructionAsync({ operator, usdcMint, startup }),
    ],
    400_000,
  )
  return { startup, mint, created: true }
}
