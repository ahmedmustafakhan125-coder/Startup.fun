// Wallet sign-in: the server issues a nonce, the wallet signs it, the server verifies the
// signature and sets a signed session cookie. Admin routes also need the wallet in ADMIN_WALLETS.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { address, getPublicKeyFromAddress, type SignatureBytes, verifySignature } from '@solana/kit'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from './db.ts'
import type { Env } from './env.ts'

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in wallet address. Set by the `user` and `admin` guards. */
    wallet: string
  }
}

const COOKIE = 'obverse_session'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000
const NONCE_MS = 5 * 60 * 1000
// Bounds the memory one client can make the server hold by asking for nonces for made-up addresses.
const MAX_PENDING_NONCES = 10_000

export const sign = (secret: string, value: string) => createHmac('sha256', secret).update(value).digest('base64url')

function safeEqual(a: string, b: string) {
  const [x, y] = [Buffer.from(a), Buffer.from(b)]
  return x.length === y.length && timingSafeEqual(x, y)
}

/** The wallet a request's session cookie belongs to, or null. */
export function walletOf(req: FastifyRequest, secret: string): string | null {
  const cookie = (req.headers.cookie ?? '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='))
  const [wallet, expires, mac] = (cookie?.slice(COOKIE.length + 1) ?? '').split('.')
  if (!wallet || !expires || !mac) return null
  if (!safeEqual(mac, sign(secret, `${wallet}.${expires}`)) || Number(expires) < Date.now()) return null
  return wallet
}

export function guards(env: Env) {
  const user = async (req: FastifyRequest, reply: FastifyReply) => {
    const wallet = walletOf(req, env.sessionSecret)
    if (!wallet) return reply.code(401).send({ error: 'NotSignedIn', message: 'Sign in with your wallet first.' })
    req.wallet = wallet
  }
  const admin = async (req: FastifyRequest, reply: FastifyReply) => {
    const wallet = walletOf(req, env.sessionSecret)
    if (!wallet) return reply.code(401).send({ error: 'NotSignedIn', message: 'Sign in with your wallet first.' })
    if (!env.adminWallets.includes(wallet)) return reply.code(403).send({ error: 'NotAdmin', message: 'This wallet is not an admin.' })
    req.wallet = wallet
  }
  return { user, admin }
}

export function authRoutes(app: FastifyInstance, { db, env }: { db: Db; env: Env }) {
  // shortcut: nonces live in memory, so a restart drops pending sign-ins; move to the database with more than one process.
  const nonces = new Map<string, { message: string; expires: number }>()
  const { user } = guards(env)

  app.post<{ Body: { address: string } }>(
    '/auth/nonce',
    { schema: { body: { type: 'object', required: ['address'], properties: { address: { type: 'string', maxLength: 64 } } } } },
    async (req, reply) => {
      let wallet: string
      try {
        wallet = address(req.body.address)
      } catch {
        return reply.code(400).send({ error: 'InvalidAddress', message: 'That is not a wallet address.' })
      }
      for (const [key, nonce] of nonces) if (nonce.expires < Date.now()) nonces.delete(key)
      if (nonces.size >= MAX_PENDING_NONCES) return reply.code(503).send({ error: 'Busy', message: 'Too many wallets are signing in at once. Try again in a few minutes.' })
      const message = `Sign in to Startup.fun (devnet)\nWallet: ${wallet}\nNonce: ${randomBytes(16).toString('hex')}`
      nonces.set(wallet, { message, expires: Date.now() + NONCE_MS })
      return { message }
    },
  )

  app.post<{ Body: { address: string; signature: string } }>(
    '/auth/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['address', 'signature'],
          properties: { address: { type: 'string', maxLength: 64 }, signature: { type: 'string', maxLength: 128 } },
        },
      },
    },
    async (req, reply) => {
      const denied = () => reply.code(401).send({ error: 'BadSignature', message: 'The signature did not match. Try signing in again.' })
      const nonce = nonces.get(req.body.address)
      nonces.delete(req.body.address) // one attempt per nonce
      if (!nonce || nonce.expires < Date.now()) return denied()
      try {
        const key = await getPublicKeyFromAddress(address(req.body.address))
        const signature = new Uint8Array(Buffer.from(req.body.signature, 'base64')) as SignatureBytes
        if (!(await verifySignature(key, signature, new TextEncoder().encode(nonce.message)))) return denied()
      } catch {
        return denied()
      }
      const wallet = req.body.address
      await db.user.upsert({ where: { address: wallet }, create: { address: wallet }, update: {} })
      const expires = Date.now() + SESSION_MS
      const value = `${wallet}.${expires}.${sign(env.sessionSecret, `${wallet}.${expires}`)}`
      const secure = env.appUrl.startsWith('https://') ? '; Secure' : ''
      reply.header('set-cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`)
      return { address: wallet, admin: env.adminWallets.includes(wallet) }
    },
  )

  app.post('/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
    return { ok: true }
  })

  app.get('/me', { preHandler: user }, async req => ({ address: req.wallet, admin: env.adminWallets.includes(req.wallet) }))
}
