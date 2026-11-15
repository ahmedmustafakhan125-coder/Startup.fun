// GitHub sign-in for the code-repository check. Only active when GITHUB_CLIENT_ID is set.
import type { FastifyInstance } from 'fastify'
import { saveCheck } from './applications.ts'
import { guards, sign } from './auth.ts'
import { githubOwnership } from './checks.ts'
import type { Db } from './db.ts'
import type { Env } from './env.ts'

export function githubRoutes(app: FastifyInstance, { db, env }: { db: Db; env: Env }) {
  if (!env.githubClientId) return
  const { user } = guards(env)
  const callback = `${env.appUrl}/api/auth/github/callback`
  const query = { type: 'object', properties: { application: { type: 'string', maxLength: 64 }, code: { type: 'string', maxLength: 200 }, state: { type: 'string', maxLength: 200 } } }

  app.get<{ Querystring: { application?: string } }>('/auth/github/start', { preHandler: user, schema: { querystring: query } }, async (req, reply) => {
    const a = await db.application.findUnique({ where: { id: req.query.application ?? '' } })
    if (!a || a.wallet !== req.wallet) return reply.code(404).send({ error: 'NotFound', message: 'Application not found.' })
    // The state ties GitHub's answer to this wallet and application, so it cannot be replayed for another.
    const state = `${a.id}.${sign(env.sessionSecret, `github.${a.id}.${req.wallet}`)}`
    return reply.redirect(`https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: env.githubClientId, scope: 'read:org', state, redirect_uri: callback })}`)
  })

  app.get<{ Querystring: { code?: string; state?: string } }>('/auth/github/callback', { preHandler: user, schema: { querystring: query } }, async (req, reply) => {
    const [id, mac] = (req.query.state ?? '').split('.')
    const a = id ? await db.application.findUnique({ where: { id } }) : null
    if (!a || a.wallet !== req.wallet || mac !== sign(env.sessionSecret, `github.${a.id}.${req.wallet}`) || !req.query.code)
      return reply.code(400).send({ error: 'BadState', message: 'That GitHub login did not start here. Try again from the listing form.' })
    let token: string | undefined
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: env.githubClientId, client_secret: env.githubClientSecret, code: req.query.code, redirect_uri: callback }),
        signal: AbortSignal.timeout(8_000),
      })
      token = ((await res.json()) as { access_token?: string }).access_token
    } catch {
      // handled below: no token
    }
    // The token is used once, here, and never stored.
    await saveCheck(db, a.id, 'github', token ? await githubOwnership(a.github, token) : { status: 'failed', detail: 'GitHub login did not complete.' })
    return reply.redirect(`${env.appUrl}/list`)
  })
}
