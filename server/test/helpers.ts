import { readdirSync, readFileSync } from 'node:fs'
import { createKeyPairSignerFromPrivateKeyBytes, type KeyPairSigner } from '@solana/kit'
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { type AppDeps, buildApp } from '../src/app.ts'
import type { Chain, LiveStartup } from '../src/chain.ts'
import type { Checks } from '../src/checks.ts'
import { createDb, type Db } from '../src/db.ts'
import { type Env, loadEnv } from '../src/env.ts'

/** A fresh in-memory database with every migration applied. */
export async function testDb(): Promise<Db> {
  const db = createDb('file::memory:')
  const dir = new URL('../prisma/migrations/', import.meta.url)
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith('.toml')) continue
    const sql = readFileSync(new URL(`${name}/migration.sql`, dir), 'utf8')
    for (const statement of sql.split(/;\s*\n/)) if (statement.trim()) await db.$executeRawUnsafe(statement)
  }
  return db
}

export const SECRET = 'test-session-secret-0123456789abcdef'

/** Checks that pass unless a test sets `failing`. */
export function mockChecks(failing = new Set<string>()): Checks {
  const run = (key: string) => async () =>
    failing.has(key) ? { status: 'failed' as const, detail: `${key} failed` } : { status: 'passed' as const, detail: `${key} passed` }
  return { kyc: run('kyc'), domain: run('domain'), github: run('github'), socials: run('socials') }
}

/** A chain that accepts the fee signature "paid" and records what the operator was asked to send. */
export function fakeChain() {
  const sent: string[] = []
  /** What the chain says is Live. Tests add to this; report_heartbeat updates it. */
  const live: LiveStartup[] = []
  const chain: Chain = {
    monthSeconds: 300,
    liveStartups: async () => live.map(l => ({ ...l })),
    reportHeartbeat: async (ticker, green) => {
      sent.push(`heartbeat ${ticker} ${green ? 'green' : 'red'}`)
      const entry = live.find(l => l.ticker === ticker)!
      entry.green = green
      if (green) entry.lastBeat = Math.floor(Date.now() / 1000)
      return 'sig-heartbeat'
    },
    verifyFee: async signature => (signature.startsWith('paid') ? null : 'That transaction does not pay the verification fee for this application.'),
    listStartup: async args => {
      sent.push(`list ${args.ticker}`)
      return { signature: 'sig-list', address: `address-${args.ticker}`, mint: `mint-${args.ticker}` }
    },
    signaturesSince: async () => [],
    logsOf: async () => null,
    tickerOf: async () => null,
    closeRaise: async ticker => {
      sent.push(`close ${ticker}`)
      return 'sig-close'
    },
  }
  return { chain, sent, live }
}

export async function testApp(overrides: Partial<Omit<AppDeps, 'env'>> & { env?: Partial<Env> } = {}) {
  const admin = await wallet()
  const db = overrides.db ?? (await testDb())
  const env = { ...loadEnv({ SESSION_SECRET: SECRET, ADMIN_WALLETS: admin.address }), ...overrides.env }
  const { chain, sent, live } = fakeChain()
  const deps = { db, chain, checks: mockChecks(), ...overrides, env }
  return { app: buildApp(deps), deps, db, admin, sent, live }
}

export const wallet = () => createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(randomBytes(32)))

/** Signs in the way the frontend does and returns the session cookie. */
export async function signIn(app: FastifyInstance, signer: KeyPairSigner): Promise<string> {
  const nonce = await app.inject({ method: 'POST', url: '/auth/nonce', payload: { address: signer.address } })
  const { message } = nonce.json<{ message: string }>()
  const [signed] = await signer.signMessages([{ content: new TextEncoder().encode(message), signatures: {} }])
  const signature = signed![signer.address]
  const res = await app.inject({
    method: 'POST',
    url: '/auth/verify',
    payload: { address: signer.address, signature: Buffer.from(signature!).toString('base64') },
  })
  return String(res.headers['set-cookie']).split(';')[0]!
}

export const FORM = {
  founderName: 'Ada Founder', founderRole: 'CEO', country: 'Pakistan', email: 'ada@example.com', name: 'Acme', ticker: 'acme',
  tagline: 'Invoices that file themselves', about: '', category: 'Fintech', website: 'acme.example', github: 'acme/app', social: '@acme',
  raiseTarget: 100_000, monthlyBudget: 8_000, feeCap: 1_200,
}
