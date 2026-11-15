import Fastify, { type FastifyInstance } from 'fastify'
import { applicationRoutes, type Deps } from './applications.ts'
import { authRoutes } from './auth.ts'
import { githubRoutes } from './github.ts'
import { marketRoutes } from './market.ts'
import { startupRoutes } from './startups.ts'

export interface AppDeps extends Deps {
  /** `true` logs to stdout; a stream captures the log (tests). */
  logger?: boolean | { stream: { write(line: string): void } }
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  service: 'obverse-server'
  network: 'devnet'
  db: 'ok' | 'down'
  time: string
}

export function buildApp({ logger = false, ...deps }: AppDeps): FastifyInstance {
  const { db } = deps
  // Log the path only: query strings can carry OAuth codes, and headers carry the session cookie.
  const serializers = { req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }) }
  const app = Fastify({ logger: logger && { serializers, ...(logger === true ? {} : logger) } })
  app.decorateRequest('wallet', '')
  authRoutes(app, deps)
  githubRoutes(app, deps)
  applicationRoutes(app, deps)
  startupRoutes(app, deps)
  marketRoutes(app, deps)

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
