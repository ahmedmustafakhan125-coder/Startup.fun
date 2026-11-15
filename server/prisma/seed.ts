// Gives the sample startups that scripts/seed.ts listed on devnet their profiles, so the API can
// serve them. Safe to run again.   npm run db:seed
import { seedStartups } from '../../app/src/data/seed.ts'
import { createRpc, fetchAllMaybeStartup, findMintPda, findStartupAddress } from '../../sdk/src/index.ts'
import { createDb } from '../src/db.ts'
import { loadEnv } from '../src/env.ts'

const env = loadEnv()
const db = createDb(env.databaseUrl)
const samples = seedStartups()
const addresses = await Promise.all(samples.map(s => findStartupAddress(s.ticker)))
const accounts = await fetchAllMaybeStartup(createRpc(env.rpcUrl), addresses)

for (const [i, s] of samples.entries()) {
  const account = accounts[i]!
  if (!account.exists) {
    console.log(`${s.ticker}: not on-chain, skipped (run scripts/seed.ts first)`)
    continue
  }
  const profile = {
    name: s.name, tagline: s.tagline, about: s.about, category: s.category, country: s.country,
    website: s.website, github: s.github, social: s.social, founders: JSON.stringify(s.founders),
    // The samples have no real site or repository to check, so their heartbeat is pinned by an override.
    override: s.heartbeat, overrideReason: 'Sample startup: nothing real to check',
  }
  await db.startup.upsert({
    where: { ticker: s.ticker },
    update: profile,
    create: { ...profile, ticker: s.ticker, founderWallet: account.data.founder, address: account.address, mint: (await findMintPda({ startup: account.address }))[0] },
  })
  console.log(`${s.ticker}: profile saved`)
}
await db.$disconnect()
