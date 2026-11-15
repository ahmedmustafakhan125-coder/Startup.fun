import 'dotenv/config'

/** Typed view of the environment. Secrets are read here and never logged. */
export interface Env {
  port: number
  host: string
  rpcUrl: string
  programId: string
  databaseUrl: string
  /** Signs session cookies and OAuth state. The server refuses to start without it. */
  sessionSecret: string
  adminWallets: string[]
  operatorKeypairPath: string
  /** Where the frontend is served; OAuth redirects come back here. */
  appUrl: string
  githubClientId: string
  githubClientSecret: string
  /** `mock` skips the DNS and HTTPS lookups; only for scripted demos. Anything else runs the real check. */
  domainMode: string
  kycMode: string
  socialMode: string
  /** Seconds between heartbeat runs (daily in production, 60 on devnet). */
  heartbeatInterval: number
  redAfterRuns: number
  aiReviewEveryRuns: number
  aiProvider: string
  aiApiKey: string
  aiModel: string
}

const DEVNET_RPC = 'https://api.devnet.solana.com'

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  const n = Number(value || fallback)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number.`)
  return n
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const rpcUrl = source.RPC_URL || DEVNET_RPC
  // Hard rule: devnet only. Refuse to start against mainnet.
  if (/mainnet/i.test(rpcUrl)) {
    throw new Error('RPC_URL points at mainnet. Obverse runs on devnet only.')
  }
  const port = Number(source.PORT ?? 8787)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT must be a valid port number.')
  }
  return {
    port,
    host: source.HOST || '127.0.0.1',
    rpcUrl,
    programId: source.PROGRAM_ID ?? '',
    databaseUrl: source.DATABASE_URL || 'file:./prisma/dev.db',
    sessionSecret: source.SESSION_SECRET ?? '',
    adminWallets: (source.ADMIN_WALLETS ?? '').split(',').map(w => w.trim()).filter(Boolean),
    operatorKeypairPath: source.OPERATOR_KEYPAIR_PATH ?? '',
    appUrl: (source.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
    githubClientId: source.GITHUB_CLIENT_ID ?? '',
    githubClientSecret: source.GITHUB_CLIENT_SECRET ?? '',
    domainMode: source.DOMAIN_MODE || 'real',
    kycMode: source.KYC_MODE || 'mock',
    socialMode: source.SOCIAL_MODE || 'mock',
    heartbeatInterval: positiveInt(source.HEARTBEAT_INTERVAL, 60, 'HEARTBEAT_INTERVAL'),
    redAfterRuns: positiveInt(source.RED_AFTER_RUNS, 2, 'RED_AFTER_RUNS'),
    aiReviewEveryRuns: positiveInt(source.AI_REVIEW_EVERY_RUNS, 5, 'AI_REVIEW_EVERY_RUNS'),
    aiProvider: source.AI_PROVIDER || 'gemini',
    aiApiKey: source.AI_API_KEY ?? '',
    aiModel: source.AI_MODEL ?? '',
  }
}
