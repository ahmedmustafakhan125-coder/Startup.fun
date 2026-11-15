import { buildApp } from './app.ts'
import { runListingJob } from './applications.ts'
import { createChain } from './chain.ts'
import { createChecks } from './checks.ts'
import { createDb } from './db.ts'
import { loadEnv } from './env.ts'

const LISTING_JOB_MS = 30_000

const env = loadEnv()
if (env.sessionSecret.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters (see .env.example).')
const deps = { db: createDb(env.databaseUrl), env, chain: await createChain(env), checks: createChecks(env) }
const app = buildApp({ ...deps, logger: true })

try {
  await app.listen({ port: env.port, host: env.host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

/** Runs a job on a timer; one run at a time, and a failed run never stops the next. */
function every(ms: number, name: string, job: () => Promise<void>) {
  let running = false
  setInterval(async () => {
    if (running) return
    running = true
    try {
      await job()
    } catch (err) {
      app.log.error({ err }, `${name} failed`)
    } finally {
      running = false
    }
  }, ms)
}
every(LISTING_JOB_MS, 'listing job', () => runListingJob(deps))
