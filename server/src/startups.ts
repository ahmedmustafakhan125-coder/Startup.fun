// Listed startups: public profiles, founder updates, the admin heartbeat override and AI flags.
import type { FastifyInstance } from 'fastify'
import { audit, type Deps, view } from './applications.ts'
import { guards } from './auth.ts'
import type { Db } from './db.ts'
import type { Application, Check, Startup } from './generated/prisma/client.ts'
import { type BeatResults, syncHeartbeat } from './heartbeat.ts'
import { marketOf } from './market.ts'

const BEATS_SHOWN = 14

/**
 * What anyone may see about a listed startup: profile, checks, heartbeat history, founder updates
 * and the latest AI review. No wallet-private fields (the application's email stays with its owner and admins).
 */
async function profile(db: Db, s: Startup) {
  const [market, applied, runs, review, updates] = await Promise.all([
    marketOf(db, s.ticker),
    s.applicationId ? db.check.findMany({ where: { applicationId: s.applicationId } }) : ([] as Check[]),
    db.heartbeatRun.findMany({ where: { ticker: s.ticker }, orderBy: { id: 'desc' }, take: BEATS_SHOWN }),
    db.aiReview.findFirst({ where: { ticker: s.ticker }, orderBy: { id: 'desc' } }),
    db.update.findMany({ where: { ticker: s.ticker }, orderBy: { id: 'desc' }, take: 20 }),
  ])
  const checks = view({ checks: applied } as Application & { checks: Check[] }).checks
  // After listing, the recurring checks are the current truth for the three things they re-test.
  const latest = runs[0]
  if (latest) {
    const results = JSON.parse(latest.results) as BeatResults
    for (const [key, beat] of [['domain', results.website], ['github', results.code], ['socials', results.socials]] as const)
      checks[key] = { status: beat.passed ? 'passed' : 'failed', detail: beat.detail, checkedAt: latest.createdAt.getTime() }
  }
  const beats = runs.map(r => (r.failing ? 0 : 1)).reverse()
  const { founders, failingRuns: _f, runsSinceAi: _r, verifyCode: _v, applicationId: _a, listedAt, feesClaimed, ...rest } = s
  return {
    ...rest,
    ...market,
    feesClaimedTotal: Number(feesClaimed) / 1e6,
    id: s.ticker.toLowerCase(),
    founders: JSON.parse(founders) as unknown,
    listedAt: listedAt.getTime(),
    checks,
    beats: [...Array<number>(BEATS_SHOWN - beats.length).fill(1), ...beats],
    updates: updates.map(u => ({ id: u.id, body: u.body, createdAt: u.createdAt.getTime() })),
    /** Null when no review exists (no AI key set, or none has run yet). */
    aiReview: review && {
      score: review.score, verdict: review.verdict, reasons: JSON.parse(review.reasons) as unknown, evidence: JSON.parse(review.evidence) as unknown, createdAt: review.createdAt.getTime(),
    },
  }
}

export function startupRoutes(app: FastifyInstance, deps: Deps) {
  const { db, env, chain } = deps
  const { user, admin } = guards(env)
  const params = { type: 'object', properties: { id: { type: 'string', maxLength: 16 } } }
  const find = (id: string) => db.startup.findUnique({ where: { ticker: id.toUpperCase() } })
  const missing = { error: 'NotFound', message: 'Startup not found.' }

  app.get('/startups', async () => Promise.all((await db.startup.findMany({ orderBy: { listedAt: 'desc' } })).map(s => profile(db, s))))

  app.get<{ Params: { id: string } }>('/startups/:id', { schema: { params } }, async (req, reply) => {
    const s = await find(req.params.id)
    return s ? profile(db, s) : reply.code(404).send(missing)
  })

  app.post<{ Params: { id: string }; Body: { body: string } }>(
    '/startups/:id/updates',
    { preHandler: user, schema: { params, body: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 20, maxLength: 4000 } } } } },
    async (req, reply) => {
      const s = await find(req.params.id)
      if (!s) return reply.code(404).send(missing)
      if (s.founderWallet !== req.wallet) return reply.code(403).send({ error: 'NotFounder', message: 'Only the founder’s wallet can post updates.' })
      const update = await db.update.create({ data: { ticker: s.ticker, body: req.body.body.trim() } })
      return { id: update.id, body: update.body, createdAt: update.createdAt.getTime() }
    },
  )

  /** Forces Green or Red with a written reason, or clears the override with `status: null`. */
  app.post<{ Params: { id: string }; Body: { status: 'green' | 'red' | null; reason?: string } }>(
    '/admin/startups/:id/heartbeat',
    {
      preHandler: admin,
      schema: { params, body: { type: 'object', required: ['status'], properties: { status: { enum: ['green', 'red', null] }, reason: { type: 'string', maxLength: 1000 } } } },
    },
    async (req, reply) => {
      const s = await find(req.params.id)
      if (!s) return reply.code(404).send(missing)
      const { status, reason = '' } = req.body
      if (status && reason.trim().length < 8) return reply.code(400).send({ error: 'ReasonNeeded', message: 'Write a short reason for the override.' })
      await db.startup.update({ where: { ticker: s.ticker }, data: { override: status, overrideReason: status ? reason.trim() : null } })
      await audit(db, req.wallet, status ? `override_${status}` : 'override_cleared', s.ticker, reason.trim())
      // Apply it now instead of waiting for the next run. Clearing waits: the next run decides.
      const live = status ? (await chain.liveStartups()).find(l => l.ticker === s.ticker) : undefined
      if (live) await syncHeartbeat(deps, live, status === 'green', Date.now()).catch(() => {}) // the next run retries
      return { ok: true }
    },
  )

  app.get('/admin/flags', { preHandler: admin }, async () => {
    const flags = await db.flag.findMany({ orderBy: [{ resolvedAt: { sort: 'asc', nulls: 'first' } }, { id: 'desc' }], take: 100 })
    const reviews = await db.aiReview.findMany({ where: { id: { in: flags.map(f => f.aiReviewId) } } })
    return flags.map(f => {
      const review = reviews.find(r => r.id === f.aiReviewId)
      return {
        id: f.id, ticker: f.ticker, ruleVerdict: f.ruleVerdict, aiVerdict: f.aiVerdict, score: review?.score ?? 0,
        reasons: review ? (JSON.parse(review.reasons) as unknown) : [], createdAt: f.createdAt.getTime(),
        resolution: f.resolution ?? undefined, resolvedAt: f.resolvedAt?.getTime(),
      }
    })
  })

  app.post<{ Params: { id: string }; Body: { resolution: string } }>(
    '/admin/flags/:id/resolve',
    { preHandler: admin, schema: { params, body: { type: 'object', required: ['resolution'], properties: { resolution: { type: 'string', minLength: 3, maxLength: 1000 } } } } },
    async (req, reply) => {
      const flag = await db.flag.findUnique({ where: { id: Number(req.params.id) || 0 } })
      if (!flag) return reply.code(404).send({ error: 'NotFound', message: 'Flag not found.' })
      if (flag.resolvedAt) return reply.code(409).send({ error: 'AlreadyResolved', message: 'This flag is already resolved.' })
      await db.flag.update({ where: { id: flag.id }, data: { resolution: req.body.resolution.trim(), resolvedBy: req.wallet, resolvedAt: new Date() } })
      await audit(db, req.wallet, 'flag_resolved', flag.ticker, req.body.resolution.trim())
      return { ok: true }
    },
  )
}
