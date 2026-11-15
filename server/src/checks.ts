// Verification checks. Each one sits behind the same interface, so a mock and a real
// implementation are interchangeable by env var (ARCHITECTURE.md 5.3).
import { resolveTxt } from 'node:dns/promises'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import type { Env } from './env.ts'

export const CHECK_KEYS = ['kyc', 'domain', 'github', 'socials', 'founder'] as const
export type CheckKey = (typeof CHECK_KEYS)[number]
/** The checks a founder (or the heartbeat) can run; `founder` is decided by an admin. */
export type AutoCheck = Exclude<CheckKey, 'founder'>
export interface CheckResult {
  status: 'passed' | 'failed' | 'pending'
  detail: string
}
/** What a check needs to know about the startup. Everything here is founder-supplied, untrusted input. */
export interface Subject {
  website: string
  github: string
  social: string
  verifyCode: string
}
export type Checks = Record<AutoCheck, (subject: Subject) => Promise<CheckResult>>

const passed = (detail: string): CheckResult => ({ status: 'passed', detail })
const failed = (detail: string): CheckResult => ({ status: 'failed', detail })

// The founder chooses the domain, so the HTTPS request must never reach this machine or its network.
const internal = new BlockList()
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const)
  internal.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10]] as const) internal.addSubnet(net, bits, 'ipv6')

export const isInternalAddress = (ip: string, family: number) => internal.check(ip, family === 6 ? 'ipv6' : 'ipv4')
export const isDomain = (value: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value) && !isIP(value)

/** Real check: the TXT record is on the domain and the site answers over HTTPS. */
export async function domainCheck({ website, verifyCode }: Subject): Promise<CheckResult> {
  if (!isDomain(website)) return failed('That is not a domain name.')
  try {
    const records = (await resolveTxt(website)).map(chunks => chunks.join(''))
    if (!records.includes(verifyCode)) return failed(`No TXT record "${verifyCode}" on ${website} yet. DNS changes can take a few minutes.`)
  } catch {
    return failed(`Could not read the DNS records of ${website}.`)
  }
  try {
    const addresses = await lookup(website, { all: true })
    if (addresses.some(a => isInternalAddress(a.address, a.family))) return failed(`${website} does not point to a public server.`)
    // shortcut: the address could change between this lookup and the request (DNS rebinding); the request
    // returns only a status, never a body. Pin the resolved address if this ever fetches content.
    const res = await fetch(`https://${website}/`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8_000) })
    if (res.status >= 400) return failed(`${website} answered with an error (${res.status}).`)
  } catch {
    return failed(`${website} did not respond over HTTPS.`)
  }
  return passed(`TXT record found and ${website} responds`)
}

/** `owner` or `owner/repo`, from a handle or a github.com URL. */
export function parseGithub(value: string): { owner: string; repo?: string } | null {
  const [owner, repo] = value.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/\.git$/, '').split('/')
  // Names go into an API path, so nothing that could walk it ("..") is accepted.
  const name = /^[\w-][\w.-]*$/
  if (!owner || !name.test(owner) || (repo && !name.test(repo))) return null
  return { owner, repo: repo || undefined }
}

async function github(path: string, token?: string) {
  return fetch(`https://api.github.com${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'obverse-devnet', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(8_000),
  })
}

/** Application time: the signed-in GitHub user owns or administers the repository or organisation. */
export async function githubOwnership(value: string, token: string): Promise<CheckResult> {
  const target = parseGithub(value)
  if (!target) return failed('That is not a GitHub repository or organisation.')
  try {
    const me = (await (await github('/user', token)).json()) as { login?: string }
    if (!me.login) return failed('GitHub did not confirm who signed in.')
    if (target.repo) {
      const repo = (await (await github(`/repos/${target.owner}/${target.repo}`, token)).json()) as { permissions?: { admin?: boolean } }
      if (repo.permissions?.admin) return passed(`${me.login} administers ${target.owner}/${target.repo}`)
      return failed(`${me.login} is not an administrator of ${target.owner}/${target.repo}.`)
    }
    if (me.login.toLowerCase() === target.owner.toLowerCase()) return passed(`${me.login} owns this account`)
    const membership = (await (await github(`/user/memberships/orgs/${target.owner}`, token)).json()) as { role?: string }
    if (membership.role === 'admin') return passed(`${me.login} is an owner of ${target.owner}`)
    return failed(`${me.login} is not an owner of ${target.owner}.`)
  } catch {
    return failed('GitHub did not answer. Try again.')
  }
}

/** Heartbeat: something was pushed within the last 30 days. Reads public data only. */
export async function githubActivity({ github: value }: Subject): Promise<CheckResult> {
  const target = parseGithub(value)
  if (!target) return failed('That is not a GitHub repository or organisation.')
  try {
    const res = await github(target.repo ? `/repos/${target.owner}/${target.repo}` : `/users/${target.owner}/repos?sort=pushed&per_page=1`)
    if (!res.ok) return failed(`GitHub could not find ${value} (${res.status}).`)
    const body = (await res.json()) as { pushed_at?: string } | { pushed_at?: string }[]
    const pushedAt = (Array.isArray(body) ? body[0] : body)?.pushed_at
    const days = pushedAt ? (Date.now() - Date.parse(pushedAt)) / 86_400_000 : Infinity
    return days <= 30 ? passed(`Last push ${Math.floor(days)} days ago`) : failed('No commits in the last 30 days.')
  } catch {
    return failed('GitHub did not answer.')
  }
}

/**
 * The adapters for this environment. KYC and socials are mocked on devnet (no documents are ever
 * collected); the code check is real once GitHub OAuth keys are set.
 */
export function createChecks(env: Env): Checks {
  return {
    kyc: async () => (env.kycMode === 'mock' ? passed('Sandbox identity check passed') : failed(`KYC provider "${env.kycMode}" is not set up.`)),
    domain: env.domainMode === 'mock' ? async ({ website }) => passed(`Mock check: ${website} is treated as verified`) : domainCheck,
    github: env.githubClientId ? githubActivity : async () => passed('Mock check: no GitHub OAuth keys are set'),
    socials: async () => (env.socialMode === 'mock' ? passed('Mock check: the account is treated as controlled') : failed(`Social provider "${env.socialMode}" is not set up.`)),
  }
}
