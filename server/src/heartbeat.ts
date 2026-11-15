// The heartbeat: recurring checks for every live startup, the rule that turns them into Green or
// Red, and the AI review that can only raise a flag for a person (ARCHITECTURE.md 5.4 and 5.5).
import { PROMPT_VERSION, type Review, type Reviewer, type ReviewInput } from './ai.ts'
import type { Deps } from './applications.ts'
import type { LiveStartup } from './chain.ts'
import { type CheckResult, parseGithub } from './checks.ts'
import type { Startup } from './generated/prisma/client.ts'

export const BEAT_KEYS = ['website', 'code', 'socials', 'update'] as const
export type BeatKey = (typeof BEAT_KEYS)[number]
export type BeatResults = Record<BeatKey, { passed: boolean; detail: string }>
// Run ids are shared by all startups, so this keeps the last few hundred runs of each.
const KEEP_IDS = 2_500

/** A run is failing when two or more checks fail. */
export const isFailing = (results: BeatResults) => BEAT_KEYS.filter(key => !results[key].passed).length >= 2

/**
 * Red after `redAfterRuns` failing runs in a row; Green again after one passing run.
 * Returns the new streak of failing runs and the status the rules ask for.
 */
export function nextStatus(failingRuns: number, wasGreen: boolean, failing: boolean, redAfterRuns: number): { failingRuns: number; green: boolean } {
  if (!failing) return { failingRuns: 0, green: true }
  const streak = failingRuns + 1
  return { failingRuns: streak, green: wasGreen && streak < redAfterRuns }
}

/** The combination table: the AI review never sets the heartbeat; a disagreement becomes a flag. */
export const disagrees = (ruleFailing: boolean, verdict: Review['verdict']) => (ruleFailing ? verdict === 'active' : verdict === 'inactive')

export interface HeartbeatDeps extends Deps {
  reviewer: Reviewer | null
  /** Recent commit messages for the AI review. Injected so tests never call GitHub. */
  commits?: (github: string) => Promise<string[]>
}

async function recentCommits(value: string): Promise<string[]> {
  const target = parseGithub(value)
  if (!target?.repo) return []
  try {
    const res = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}/commits?per_page=20`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'obverse-devnet' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []
    return ((await res.json()) as { commit?: { message?: string } }[]).map(c => c.commit?.message?.split('\n')[0] ?? '').filter(Boolean)
  } catch {
    return []
  }
}

/** The four recurring checks for one startup. */
async function runChecks({ db, checks, chain }: Deps, s: Startup, live: LiveStartup, now: number): Promise<BeatResults> {
  const beat = (r: CheckResult) => ({ passed: r.status === 'passed', detail: r.detail })
  // An update counts when it was posted in the current or the previous period.
  const sincePeriodStart = (now / 1000 - live.liveAt) % chain.monthSeconds
  const cutoff = new Date(now - (sincePeriodStart + chain.monthSeconds) * 1000)
  const update = await db.update.findFirst({ where: { ticker: s.ticker, createdAt: { gte: cutoff } } })
  return {
    website: beat(await checks.domain(s)),
    code: beat(await checks.github(s)),
    socials: beat(await checks.socials(s)),
    update: update ? { passed: true, detail: 'Update posted this period or last' } : { passed: false, detail: 'No founder update this period or last' },
  }
}

async function aiReview(deps: HeartbeatDeps, s: Startup, results: BeatResults, failing: boolean, now: number) {
  const { db, reviewer } = deps
  if (!reviewer) return
  const update = await db.update.findFirst({ where: { ticker: s.ticker }, orderBy: { createdAt: 'desc' } })
  const input: ReviewInput = {
    name: s.name,
    tagline: s.tagline,
    update: update ? { body: update.body, ageDays: (now - update.createdAt.getTime()) / 86_400_000 } : undefined,
    commits: await (deps.commits ?? recentCommits)(s.github),
    checks: BEAT_KEYS.map(key => `${key}: ${results[key].passed ? 'passed' : 'failed'}, ${results[key].detail}`),
  }
  const review = await reviewer.review(input)
  if (!review) return // unusable output is dropped; the rule checks stand on their own
  const saved = await db.aiReview.create({
    data: { ticker: s.ticker, score: review.score, verdict: review.verdict, reasons: JSON.stringify(review.reasons), evidence: JSON.stringify(review.evidence), model: reviewer.model, promptVersion: PROMPT_VERSION },
  })
  if (disagrees(failing, review.verdict) && !(await db.flag.findFirst({ where: { ticker: s.ticker, resolvedAt: null } })))
    await db.flag.create({ data: { ticker: s.ticker, ruleVerdict: failing ? 'failing' : 'passing', aiVerdict: review.verdict, aiReviewId: saved.id } })
}

/** Sends report_heartbeat when the wanted status differs from the chain, or to refresh last_beat once a period while green. */
export async function syncHeartbeat({ chain, db }: Deps, live: LiveStartup, green: boolean, now: number): Promise<string | undefined> {
  const stale = green && now / 1000 - live.lastBeat >= chain.monthSeconds
  if (green === live.green && !stale) return undefined
  const signature = await chain.reportHeartbeat(live.ticker, green)
  await db.auditLog.create({ data: { actor: 'heartbeat-job', action: 'report_heartbeat', target: live.ticker, detail: green ? 'green' : 'red', signature } })
  return signature
}

/** One heartbeat run over every live startup that has a profile. Runs on a timer in index.ts. */
export async function runHeartbeat(deps: HeartbeatDeps, now = Date.now()) {
  const { db, env, chain } = deps
  for (const live of await chain.liveStartups()) {
    const s = await db.startup.findUnique({ where: { ticker: live.ticker } })
    if (!s) continue
    const results = await runChecks(deps, s, live, now)
    const failing = isFailing(results)
    const rule = nextStatus(s.failingRuns, live.green, failing, env.redAfterRuns)
    // An admin override holds until it is cleared; the rules keep counting underneath it.
    const green = s.override ? s.override === 'green' : rule.green
    const dueForAi = s.runsSinceAi + 1 >= env.aiReviewEveryRuns
    await db.startup.update({ where: { ticker: s.ticker }, data: { failingRuns: rule.failingRuns, runsSinceAi: dueForAi ? 0 : s.runsSinceAi + 1 } })
    let signature: string | undefined
    try {
      signature = await syncHeartbeat(deps, live, green, now)
    } catch {
      // The run is still recorded; the next run sends the report again because the chain still differs.
    }
    const run = await db.heartbeatRun.create({ data: { ticker: s.ticker, results: JSON.stringify(results), failing, verdict: green ? 'green' : 'red', signature } })
    await db.heartbeatRun.deleteMany({ where: { ticker: s.ticker, id: { lte: run.id - KEEP_IDS } } })
    if (dueForAi) await aiReview(deps, s, results, failing, now)
  }
}
