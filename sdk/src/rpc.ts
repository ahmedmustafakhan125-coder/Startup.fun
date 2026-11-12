import { createDefaultRpcTransport, createSolanaRpcFromTransport } from '@solana/kit'

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
