import Fastify, { type FastifyInstance } from 'fastify'
import type { Db } from './db.ts'

export interface AppDeps {
  db: Db
  logger?: boolean
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  service: 'obverse-server'
  network: 'devnet'
  db: 'ok' | 'down'
  time: string
}

export function buildApp({ db, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger })

  app.get('/health', async (_req, reply): Promise<HealthResponse> => {
    let dbOk = true
    try {
      await db.$queryRaw`SELECT 1`
    } catch (err) {
      dbOk = false
      app.log.error({ err }, 'health: database check failed')
    }
    if (!dbOk) reply.code(503)
    return {
      status: dbOk ? 'ok' : 'degraded',
      service: 'obverse-server',
      network: 'devnet',
      db: dbOk ? 'ok' : 'down',
      time: new Date().toISOString(),
    }
  })

  app.addHook('onClose', async () => {
    await db.$disconnect()
  })

  return app
}
