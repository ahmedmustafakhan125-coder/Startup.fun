import { buildApp } from './app.ts'
import { createDb } from './db.ts'
import { loadEnv } from './env.ts'

const env = loadEnv()
const app = buildApp({ db: createDb(env.databaseUrl), logger: true })

try {
  await app.listen({ port: env.port, host: env.host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
