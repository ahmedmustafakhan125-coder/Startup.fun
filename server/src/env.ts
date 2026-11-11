import 'dotenv/config'

/** Typed view of the environment. Secrets are read here and never logged. */
export interface Env {
  port: number
  host: string
  rpcUrl: string
  programId: string
  databaseUrl: string
}

const DEVNET_RPC = 'https://api.devnet.solana.com'

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
  }
}
