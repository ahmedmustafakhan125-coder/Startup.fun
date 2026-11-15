import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { runListingJob } from '../src/applications.ts'
import { FORM, mockChecks, SECRET, signIn, testApp, wallet } from './helpers.ts'

type Json = Record<string, any> // test-only: responses are inspected field by field

const call = (app: FastifyInstance, cookie: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie } })

/** Runs the wizard's path: draft, four checks, submit with a paid fee. Returns the application. */
async function apply(app: FastifyInstance, cookie: string, form = FORM) {
  const draft = (await call(app, cookie, 'PUT', '/applications/draft', form)).json<Json>()
  for (const check of ['kyc', 'domain', 'github', 'socials']) await call(app, cookie, 'POST', `/applications/${draft.id}/verify/${check}`)
  return call(app, cookie, 'POST', '/applications', { ...form, id: draft.id, feeSignature: `paid-${draft.id}` })
}

describe('wallet sign-in', () => {
  it('sets a session for a valid signature and rejects everything else', async () => {
    const { app, admin } = await testApp()
    const founder = await wallet()
    expect((await app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401)

    const cookie = await signIn(app, founder)
    expect((await call(app, cookie, 'GET', '/me')).json()).toEqual({ address: founder.address, admin: false })
    expect((await call(app, await signIn(app, admin), 'GET', '/me')).json<Json>().admin).toBe(true)

    // A signature from another wallet, a tampered cookie and a reused nonce all fail.
    const other = await wallet()
    await app.inject({ method: 'POST', url: '/auth/nonce', payload: { address: founder.address } })
    const [signed] = await other.signMessages([{ content: new TextEncoder().encode('Sign in'), signatures: {} }])
    const forged = signed![other.address]
    const bad = await app.inject({ method: 'POST', url: '/auth/verify', payload: { address: founder.address, signature: Buffer.from(forged!).toString('base64') } })
    expect(bad.statusCode).toBe(401)
    expect((await call(app, cookie.replace(founder.address, other.address), 'GET', '/me')).statusCode).toBe(401)
    expect((await call(app, cookie.slice(0, -2) + 'xx', 'GET', '/me')).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/auth/nonce', payload: { address: 'not-an-address' } })).statusCode).toBe(400)
  })
})

describe('applying', () => {
  it('needs the four checks and a verified fee payment', async () => {
    const { app, db } = await testApp()
    const cookie = await signIn(app, await wallet())
    const draft = (await call(app, cookie, 'PUT', '/applications/draft', FORM)).json<Json>()
    expect(draft.ticker).toBe('ACME')
    expect(draft.code).toMatch(/^obverse-verify=[0-9a-f]{16}$/)
    const submit = (feeSignature: string) => call(app, cookie, 'POST', '/applications', { ...FORM, id: draft.id, feeSignature })

    expect((await submit('paid-1')).json<Json>().error).toBe('ChecksNotPassed')
    for (const check of ['kyc', 'domain', 'github', 'socials']) {
      const res = await call(app, cookie, 'POST', `/applications/${draft.id}/verify/${check}`)
      expect(res.json<Json>().check.status).toBe('passed')
    }
    expect((await call(app, cookie, 'POST', `/applications/${draft.id}/verify/founder`)).statusCode).toBe(400)
    expect((await submit('unpaid')).statusCode).toBe(402)

    const done = await submit('paid-1')
    expect(done.statusCode).toBe(200)
    expect(done.json<Json>()).toMatchObject({ status: 'submitted', checks: { domain: { status: 'passed' }, founder: { status: 'pending' } } })
    expect((await submit('paid-1')).json<Json>().error).toBe('AlreadySubmitted')
    expect((await call(app, cookie, 'GET', '/applications/mine')).json<Json[]>()).toHaveLength(1)
    expect(await db.auditLog.count({ where: { action: 'application_submitted' } })).toBe(1)

    // Another founder cannot reuse the same payment, see this application, or run its checks.
    const stranger = await signIn(app, await wallet())
    const theirs = (await call(app, stranger, 'PUT', '/applications/draft', { ...FORM, ticker: 'OTHR' })).json<Json>()
    for (const check of ['kyc', 'domain', 'github', 'socials']) await call(app, stranger, 'POST', `/applications/${theirs.id}/verify/${check}`)
    expect((await call(app, stranger, 'POST', '/applications', { ...FORM, ticker: 'OTHR', id: theirs.id, feeSignature: 'paid-1' })).json<Json>().error).toBe('FeeAlreadyUsed')
    expect((await call(app, stranger, 'GET', '/applications/mine')).json<Json[]>()).toHaveLength(0)
    expect((await call(app, stranger, 'POST', `/applications/${draft.id}/verify/kyc`)).statusCode).toBe(404)
  })

  it('voids a check when the value it proved changes, and validates the form', async () => {
    const { app } = await testApp()
    const cookie = await signIn(app, await wallet())
    const draft = (await call(app, cookie, 'PUT', '/applications/draft', FORM)).json<Json>()
    for (const check of ['kyc', 'domain', 'github', 'socials']) await call(app, cookie, 'POST', `/applications/${draft.id}/verify/${check}`)
    const moved = (await call(app, cookie, 'PUT', '/applications/draft', { website: 'other.example' })).json<Json>()
    expect(moved.id).toBe(draft.id)
    expect(moved.checks.domain.status).toBe('pending')
    expect(moved.checks.github.status).toBe('passed')
    await call(app, cookie, 'POST', `/applications/${draft.id}/verify/domain`)

    const submit = (patch: object) => call(app, cookie, 'POST', '/applications', { ...FORM, website: 'other.example', ...patch, id: draft.id, feeSignature: 'paid-2' })
    expect((await submit({ raiseTarget: 5_000 })).json<Json>().error).toBe('InvalidApplication')
    expect((await submit({ monthlyBudget: 50_000 })).json<Json>().error).toBe('InvalidApplication')
    expect((await submit({ email: 'nope' })).json<Json>().error).toBe('InvalidApplication')
    expect((await submit({ website: 'third.example' })).json<Json>().error).toBe('ChecksNotPassed')
    expect((await submit({})).statusCode).toBe(200)
  })
})

describe('admin review', () => {
  it('answers 403 to a non-admin wallet on every admin route', async () => {
    const { app } = await testApp()
    const cookie = await signIn(app, await wallet())
    const id = (await apply(app, cookie)).json<Json>().id
    const routes: ['GET' | 'POST', string, object?][] = [
      ['GET', '/admin/applications'],
      ['POST', `/admin/applications/${id}/run-checks`],
      ['POST', `/admin/applications/${id}/schedule`, { when: Date.now() }],
      ['POST', `/admin/applications/${id}/reject`, { reason: 'no' }],
      ['POST', `/admin/applications/${id}/list-now`],
      ['POST', '/admin/startups/acme/close-raise'],
    ]
    for (const [method, url, payload] of routes) {
      expect((await call(app, cookie, method, url, payload)).statusCode, url).toBe(403)
      expect((await app.inject({ method, url, payload })).statusCode, url).toBe(401)
    }
  })

  it('lists only when all five checks pass, now or at the scheduled time', async () => {
    const failing = new Set<string>()
    const { app, deps, db, admin, sent } = await testApp({ checks: mockChecks(failing) })
    const founder = await signIn(app, await wallet())
    const boss = await signIn(app, admin)
    const id = (await apply(app, founder)).json<Json>().id

    // The founder-details check is still pending, so the gate holds on both routes.
    expect((await call(app, boss, 'POST', `/admin/applications/${id}/list-now`)).json<Json>().error).toBe('ChecksNotPassed')
    expect((await call(app, boss, 'POST', `/admin/applications/${id}/schedule`, { when: Date.now() })).json<Json>().error).toBe('ChecksNotPassed')
    expect((await call(app, boss, 'POST', `/admin/applications/${id}/run-checks`)).json<Json>()).toMatchObject({ status: 'in_review', checks: { founder: { status: 'passed' } } })

    // Scheduled for later: the job leaves it alone until the time comes.
    const later = Date.now() + 60_000
    expect((await call(app, boss, 'POST', `/admin/applications/${id}/schedule`, { when: later })).json<Json>()).toMatchObject({ status: 'scheduled', scheduledFor: later })
    await runListingJob(deps)
    expect(sent).toEqual([])

    // A check that fails after approval stops the listing and sends it back to review.
    await db.application.update({ where: { id }, data: { scheduledFor: new Date(Date.now() - 1000) } })
    failing.add('domain')
    await runListingJob(deps)
    expect(sent).toEqual([])
    expect((await call(app, founder, 'GET', '/applications/mine')).json<Json[]>()[0]).toMatchObject({ status: 'in_review', checks: { domain: { status: 'failed' } } })

    failing.clear()
    await call(app, boss, 'POST', `/admin/applications/${id}/run-checks`)
    await call(app, boss, 'POST', `/admin/applications/${id}/schedule`, { when: Date.now() - 1000 })
    await runListingJob(deps)
    await runListingJob(deps) // a second run must not list it again
    expect(sent).toEqual(['list ACME'])
    expect((await call(app, founder, 'GET', '/applications/mine')).json<Json[]>()[0]).toMatchObject({ status: 'listed', startupId: 'acme' })

    // The public profile exists and does not leak private fields.
    const profile = (await app.inject({ method: 'GET', url: '/startups/acme' })).json<Json>()
    expect(profile).toMatchObject({ id: 'acme', ticker: 'ACME', name: 'Acme', founders: [{ name: 'Ada Founder', role: 'CEO' }], checks: { kyc: { status: 'passed' } } })
    expect(JSON.stringify(profile)).not.toMatch(/ada@example\.com|obverse-verify/)
    expect((await app.inject({ method: 'GET', url: '/startups' })).json<Json[]>()).toHaveLength(1)
    expect((await app.inject({ method: 'GET', url: '/startups/nope' })).statusCode).toBe(404)

    // The same ticker cannot be applied for again, and a decided application cannot be re-decided.
    expect((await apply(app, await signIn(app, await wallet()))).json<Json>().error).toBe('TickerTaken')
    expect((await call(app, boss, 'POST', `/admin/applications/${id}/reject`, { reason: 'late' })).statusCode).toBe(409)
    expect((await call(app, boss, 'POST', '/admin/startups/acme/close-raise')).json()).toEqual({ signature: 'sig-close' })
    expect(sent).toEqual(['list ACME', 'close ACME'])
    expect(await db.auditLog.count({ where: { action: { in: ['create_startup', 'close_raise'] } } })).toBe(2)
  })

  it('"list now" lists at once, and a rejection shows its reason to the founder', async () => {
    const { app, admin, sent } = await testApp()
    const boss = await signIn(app, admin)
    const first = await signIn(app, await wallet())
    const second = await signIn(app, await wallet())
    const listId = (await apply(app, first)).json<Json>().id
    const rejectId = (await apply(app, second, { ...FORM, ticker: 'NOPE', name: 'Nope' })).json<Json>().id

    await call(app, boss, 'POST', `/admin/applications/${listId}/run-checks`)
    expect((await call(app, boss, 'POST', `/admin/applications/${listId}/list-now`)).json<Json>().status).toBe('listed')
    expect(sent).toEqual(['list ACME'])

    expect((await call(app, boss, 'POST', `/admin/applications/${rejectId}/reject`, { reason: '' })).statusCode).toBe(400)
    await call(app, boss, 'POST', `/admin/applications/${rejectId}/reject`, { reason: 'The domain belongs to someone else.' })
    expect((await call(app, second, 'GET', '/applications/mine')).json<Json[]>()[0]).toMatchObject({ status: 'rejected', rejectionReason: 'The domain belongs to someone else.' })
    expect((await call(app, boss, 'GET', '/admin/applications')).json<Json[]>()).toHaveLength(2)
  })
})

describe('logs', () => {
  it('never contain the session secret, a cookie or a query string', async () => {
    const lines: string[] = []
    const { app, admin } = await testApp({ logger: { stream: { write: line => void lines.push(line) } } })
    const cookie = await signIn(app, admin)
    await call(app, cookie, 'GET', '/me?code=oauth-code-123')
    await call(app, cookie, 'GET', '/admin/applications')
    const log = lines.join('')
    expect(log).toContain('/me')
    expect(log).not.toContain(SECRET)
    expect(log).not.toContain(cookie.split('=')[1])
    expect(log).not.toContain('oauth-code-123')
  })
})
