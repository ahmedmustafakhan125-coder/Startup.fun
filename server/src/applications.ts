// Applications, the admin review queue, listing, and the public startup profiles.
import type { FastifyInstance, FastifyReply } from 'fastify'
import { randomBytes } from 'node:crypto'
import { guards } from './auth.ts'
import type { Chain } from './chain.ts'
import { type AutoCheck, CHECK_KEYS, type CheckResult, type Checks, isDomain } from './checks.ts'
import type { Db } from './db.ts'
import type { Env } from './env.ts'
import type { Application, Check } from './generated/prisma/client.ts'

export interface Deps {
  db: Db
  env: Env
  chain: Chain
  checks: Checks
}
type App = Application & { checks: Check[] }
const AUTO: AutoCheck[] = ['kyc', 'domain', 'github', 'socials']
const withChecks = { include: { checks: true } } as const

const text = (maxLength: number) => ({ type: 'string', maxLength })
const whole = { type: 'integer', minimum: 0, maximum: 1_000_000_000 }
const formFields = {
  founderName: text(120), founderRole: text(120), country: text(80), email: text(200), name: text(80), ticker: text(5),
  tagline: text(200), about: text(4000), category: text(40), website: text(253), github: text(200), social: text(200),
  raiseTarget: whole, monthlyBudget: whole, feeCap: whole,
} as const
type Form = Partial<
  Record<'founderName' | 'founderRole' | 'country' | 'email' | 'name' | 'ticker' | 'tagline' | 'about' | 'category' | 'website' | 'github' | 'social', string> &
    Record<'raiseTarget' | 'monthlyBudget' | 'feeCap', number>
>

/** The shape the frontend's `Application` type expects. */
export function view(a: App) {
  const checks = Object.fromEntries(
    CHECK_KEYS.map(key => {
      const c = a.checks.find(x => x.key === key)
      return [key, c ? { status: c.status, detail: c.detail, checkedAt: c.checkedAt?.getTime() ?? null } : { status: 'pending', detail: 'Not checked yet', checkedAt: null }]
    }),
  )
  const { verifyCode, feeSignature: _fee, createdAt: _created, startupTicker, submittedAt, scheduledFor, decidedAt, rejectionReason, ...rest } = a
  return {
    ...rest,
    checks,
    code: verifyCode,
    submittedAt: submittedAt?.getTime() ?? 0,
    scheduledFor: scheduledFor?.getTime(),
    decidedAt: decidedAt?.getTime(),
    rejectionReason: rejectionReason ?? undefined,
    startupId: startupTicker?.toLowerCase(),
  }
}

/** Same rules as the listing wizard, enforced again here because the browser is not trusted. */
function invalid(f: Form): string | null {
  if (!f.founderName?.trim() || !f.founderRole?.trim() || !f.country) return 'Add your name, role and country.'
  if (!/^\S+@\S+\.\S+$/.test(f.email ?? '')) return 'Add a valid email address.'
  if (!f.name?.trim()) return 'Add the startup name.'
  if (!/^[A-Z]{3,5}$/.test(f.ticker ?? '')) return 'The ticker needs 3 to 5 letters.'
  if ((f.tagline ?? '').trim().length < 12) return 'Describe the product in one line.'
  if (!isDomain(f.website ?? '')) return 'Add your domain, for example acme.com.'
  if (!f.github?.trim() || !f.social?.trim()) return 'Add the repository and a social handle.'
  if ((f.raiseTarget ?? 0) < 10_000) return 'The smallest raise is $10,000.'
  if ((f.monthlyBudget ?? 0) < 500) return 'Set a monthly budget of at least $500.'
  if (f.monthlyBudget! > f.raiseTarget! * 0.25) return 'The monthly budget cannot exceed a quarter of the raise.'
  return null
}

const normalise = (f: Form): Form => ({
  ...f,
  ...(f.ticker !== undefined && { ticker: f.ticker.toUpperCase() }),
  ...(f.website !== undefined && { website: f.website.trim().toLowerCase() }),
})

export async function saveCheck(db: Db, applicationId: string, key: string, result: CheckResult) {
  const data = { ...result, checkedAt: result.status === 'pending' ? null : new Date() }
  return db.check.upsert({ where: { applicationId_key: { applicationId, key } }, create: { applicationId, key, ...data }, update: data })
}

const allPassed = (a: App) => CHECK_KEYS.every(key => a.checks.find(c => c.key === key)?.status === 'passed')
export const audit = (db: Db, actor: string, action: string, target: string, detail = '', signature?: string) =>
  db.auditLog.create({ data: { actor, action, target, detail, signature } })

/** Re-runs the automated checks. A check that was passed through GitHub sign-in is kept unless it now fails. */
async function rerun({ db, checks }: Deps, a: App) {
  for (const key of AUTO) await saveCheck(db, a.id, key, await checks[key](a))
  return db.application.findUniqueOrThrow({ where: { id: a.id }, ...withChecks })
}

/**
 * Lists an approved application on-chain with the operator key. All five checks are re-checked
 * first, so a check that failed after approval stops the listing (ARCHITECTURE.md 5.3).
 */
export async function listApplication(deps: Deps, applicationId: string, actor: string): Promise<{ ok: true; ticker: string } | { ok: false; error: string }> {
  const { db, chain } = deps
  const a = await rerun(deps, await db.application.findUniqueOrThrow({ where: { id: applicationId }, ...withChecks }))
  if (!allPassed(a)) {
    await db.application.update({ where: { id: a.id }, data: { status: 'in_review', scheduledFor: null } })
    await audit(db, actor, 'listing_stopped', a.id, 'A check no longer passes')
    return { ok: false, error: 'Every check must pass before listing.' }
  }
  // Claim the application first, so the job and an admin cannot both list it.
  const claimed = await db.application.updateMany({ where: { id: a.id, status: { in: ['in_review', 'scheduled', 'submitted'] } }, data: { status: 'listing' } })
  if (!claimed.count) return { ok: false, error: 'This application is already being listed.' }
  try {
    const listed = await chain.listStartup({ ticker: a.ticker, founder: a.wallet, raiseTarget: a.raiseTarget, monthlyBudget: a.monthlyBudget, feeCap: a.feeCap })
    await db.startup.create({
      data: {
        ticker: a.ticker, applicationId: a.id, name: a.name, tagline: a.tagline, about: a.about || a.tagline, category: a.category, country: a.country,
        website: a.website, github: a.github, social: a.social, founders: JSON.stringify([{ name: a.founderName, role: a.founderRole || 'Founder' }]),
        founderWallet: a.wallet, address: listed.address, mint: listed.mint, verifyCode: a.verifyCode,
      },
    })
    await db.application.update({ where: { id: a.id }, data: { status: 'listed', startupTicker: a.ticker, decidedAt: a.decidedAt ?? new Date() } })
    await audit(db, actor, 'create_startup', a.ticker, a.id, listed.signature)
    return { ok: true, ticker: a.ticker }
  } catch (error) {
    await db.application.update({ where: { id: a.id }, data: { status: 'in_review', scheduledFor: null } })
    await audit(db, actor, 'listing_failed', a.id, String((error as Error).message).slice(0, 300))
    return { ok: false, error: 'The listing transaction failed. The application is back in review.' }
  }
}

/** Lists every scheduled application whose time has come. Runs on a timer in index.ts. */
export async function runListingJob(deps: Deps) {
  const due = await deps.db.application.findMany({ where: { status: 'scheduled', scheduledFor: { lte: new Date() } } })
  for (const a of due) await listApplication(deps, a.id, 'listing-job')
}

export function applicationRoutes(app: FastifyInstance, deps: Deps) {
  const { db, env, chain, checks } = deps
  const { user, admin } = guards(env)
  const idParams = { type: 'object', properties: { id: { type: 'string', maxLength: 64 }, check: { type: 'string', maxLength: 16 } } }
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'NotFound', message: 'Application not found.' })

  // --- founder ---

  /** Creates or updates this wallet's draft, so the wizard's checks have something to attach to. */
  app.put<{ Body: Form }>('/applications/draft', { preHandler: user, schema: { body: { type: 'object', properties: formFields } } }, async req => {
    const form = normalise(req.body)
    let draft = await db.application.findFirst({ where: { wallet: req.wallet, status: 'draft' } })
    if (!draft) draft = await db.application.create({ data: { wallet: req.wallet, verifyCode: 'obverse-verify=' + randomBytes(8).toString('hex') } })
    // A check proves something about one value; changing the value voids it.
    const stale = ([['website', 'domain'], ['github', 'github'], ['social', 'socials']] as const).filter(([field]) => form[field] !== undefined && form[field] !== draft[field]).map(([, key]) => key)
    if (stale.length) await db.check.deleteMany({ where: { applicationId: draft.id, key: { in: stale } } })
    return view(await db.application.update({ where: { id: draft.id }, data: form, ...withChecks }))
  })

  app.post<{ Params: { id: string; check: string } }>('/applications/:id/verify/:check', { preHandler: user, schema: { params: idParams } }, async (req, reply) => {
    const a = await db.application.findUnique({ where: { id: req.params.id } })
    if (!a || a.wallet !== req.wallet) return notFound(reply)
    const key = AUTO.find(k => k === req.params.check)
    if (!key) return reply.code(400).send({ error: 'UnknownCheck', message: 'There is no such check.' })
    if (!['draft', 'submitted', 'in_review'].includes(a.status)) return reply.code(409).send({ error: 'ApplicationClosed', message: 'This application can no longer be changed.' })
    // With GitHub OAuth keys set, ownership is proven by signing in to GitHub, not by this call.
    if (key === 'github' && env.githubClientId) return { redirect: `/auth/github/start?application=${a.id}` }
    return { check: await saveCheck(db, a.id, key, await checks[key](a)).then(c => ({ status: c.status, detail: c.detail, checkedAt: c.checkedAt?.getTime() ?? null })) }
  })

  app.post<{ Body: Form & { id: string; feeSignature: string } }>(
    '/applications',
    { preHandler: user, schema: { body: { type: 'object', required: ['id', 'feeSignature'], properties: { ...formFields, id: text(64), feeSignature: text(128) } } } },
    async (req, reply) => {
      const { id, feeSignature, ...raw } = req.body
      const form = normalise(raw)
      const a = await db.application.findUnique({ where: { id }, ...withChecks })
      if (!a || a.wallet !== req.wallet) return notFound(reply)
      if (a.status !== 'draft') return reply.code(409).send({ error: 'AlreadySubmitted', message: 'This application was already submitted.' })
      const problem = invalid({ ...a, ...form })
      if (problem) return reply.code(400).send({ error: 'InvalidApplication', message: problem })
      if ((['website', 'github', 'social'] as const).some(field => form[field] !== undefined && form[field] !== a[field]) || AUTO.some(key => a.checks.find(c => c.key === key)?.status !== 'passed'))
        return reply.code(409).send({ error: 'ChecksNotPassed', message: 'Pass the four checks before submitting.' })
      if (await db.startup.findUnique({ where: { ticker: form.ticker ?? a.ticker } })) return reply.code(409).send({ error: 'TickerTaken', message: 'That ticker is already listed.' })
      if (await db.application.findUnique({ where: { feeSignature } })) return reply.code(409).send({ error: 'FeeAlreadyUsed', message: 'That fee payment was already used.' })
      const feeProblem = await chain.verifyFee(feeSignature, a.id, req.wallet)
      if (feeProblem) return reply.code(402).send({ error: 'FeeNotPaid', message: feeProblem })
      await saveCheck(db, a.id, 'founder', { status: 'pending', detail: 'A reviewer compares founder details by hand' })
      await audit(db, req.wallet, 'application_submitted', a.id, '', feeSignature)
      return view(await db.application.update({ where: { id: a.id }, data: { ...form, status: 'submitted', submittedAt: new Date(), feeSignature }, ...withChecks }))
    },
  )

  app.get('/applications/mine', { preHandler: user }, async req =>
    (await db.application.findMany({ where: { wallet: req.wallet, status: { not: 'draft' } }, orderBy: { submittedAt: 'desc' }, ...withChecks })).map(view),
  )

  // --- admin ---

  app.get('/admin/applications', { preHandler: admin }, async () =>
    (await db.application.findMany({ where: { status: { not: 'draft' } }, orderBy: { submittedAt: 'desc' }, ...withChecks })).map(view),
  )

  /** Looks up a reviewable application or answers 404/409 itself. */
  const reviewable = async (id: string, reply: FastifyReply) => {
    const a = await db.application.findUnique({ where: { id }, ...withChecks })
    if (!a || a.status === 'draft') return void notFound(reply)
    if (!['submitted', 'in_review', 'scheduled'].includes(a.status)) return void reply.code(409).send({ error: 'ApplicationClosed', message: 'This application is already decided.' })
    return a
  }
  const gate = (a: App, reply: FastifyReply) => allPassed(a) || void reply.code(409).send({ error: 'ChecksNotPassed', message: 'Every check must pass before listing.' })

  /** Re-runs the automated checks. The reviewer running them is also the hand check of the founder's details. */
  app.post<{ Params: { id: string } }>('/admin/applications/:id/run-checks', { preHandler: admin, schema: { params: idParams } }, async (req, reply) => {
    const a = await reviewable(req.params.id, reply)
    if (!a) return
    await rerun(deps, a)
    await saveCheck(db, a.id, 'founder', { status: 'passed', detail: 'Founder details confirmed by a reviewer' })
    await audit(db, req.wallet, 'run_checks', a.id)
    return view(await db.application.update({ where: { id: a.id }, data: { status: a.status === 'submitted' ? 'in_review' : a.status }, ...withChecks }))
  })

  app.post<{ Params: { id: string }; Body: { when: number } }>(
    '/admin/applications/:id/schedule',
    { preHandler: admin, schema: { params: idParams, body: { type: 'object', required: ['when'], properties: { when: { type: 'integer', minimum: 0 } } } } },
    async (req, reply) => {
      const a = await reviewable(req.params.id, reply)
      if (!a || !gate(a, reply)) return
      await audit(db, req.wallet, 'schedule', a.id, new Date(req.body.when).toISOString())
      return view(await db.application.update({ where: { id: a.id }, data: { status: 'scheduled', scheduledFor: new Date(req.body.when), decidedAt: new Date() }, ...withChecks }))
    },
  )

  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/admin/applications/:id/reject',
    { preHandler: admin, schema: { params: idParams, body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 1, maxLength: 1000 } } } } },
    async (req, reply) => {
      const a = await reviewable(req.params.id, reply)
      if (!a) return
      await audit(db, req.wallet, 'reject', a.id, req.body.reason)
      return view(await db.application.update({ where: { id: a.id }, data: { status: 'rejected', rejectionReason: req.body.reason, decidedAt: new Date(), scheduledFor: null }, ...withChecks }))
    },
  )

  app.post<{ Params: { id: string } }>('/admin/applications/:id/list-now', { preHandler: admin, schema: { params: idParams } }, async (req, reply) => {
    const a = await reviewable(req.params.id, reply)
    if (!a || !gate(a, reply)) return
    const listed = await listApplication(deps, a.id, req.wallet)
    if (!listed.ok) return reply.code(409).send({ error: 'ListingFailed', message: listed.error })
    return view(await db.application.findUniqueOrThrow({ where: { id: a.id }, ...withChecks }))
  })

  app.post<{ Params: { id: string } }>('/admin/startups/:id/close-raise', { preHandler: admin, schema: { params: idParams } }, async (req, reply) => {
    const ticker = req.params.id.toUpperCase()
    if (!/^[A-Z]{3,5}$/.test(ticker)) return reply.code(400).send({ error: 'InvalidTicker', message: 'That is not a ticker.' })
    try {
      const signature = await chain.closeRaise(ticker)
      await audit(db, req.wallet, 'close_raise', ticker, '', signature)
      return { signature }
    } catch {
      return reply.code(409).send({ error: 'CloseFailed', message: 'The raise could not be closed. It is already closed or nothing was committed.' })
    }
  })
}
