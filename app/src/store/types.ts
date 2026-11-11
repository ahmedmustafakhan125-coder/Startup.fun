export type CheckKey = 'kyc' | 'domain' | 'github' | 'socials' | 'founder'
export type CheckStatus = 'passed' | 'pending' | 'failed'
export interface Check {
  status: CheckStatus
  detail: string
  checkedAt: number | null
}
export type Checks = Record<CheckKey, Check>
export type Phase = 'raising' | 'live' | 'wound_down'
export type Heartbeat = 'green' | 'red'

export interface Startup {
  id: string
  name: string
  ticker: string
  tagline: string
  about: string
  category: string
  country: string
  website: string
  github: string
  social: string
  founders: { name: string; role: string }[]
  mine: boolean
  listedAt: number
  phase: Phase
  heartbeat: Heartbeat
  redDays: number
  lastBeat: number
  beats: number[] // last 14 heartbeat results, 1 = passed
  checks: Checks
  // raise
  raiseTarget: number
  raised: number
  salePrice: number
  backers: number
  // pool
  poolUsdc: number
  poolTokens: number
  circulating: number // tokens held by the public
  // vaults
  treasury: number
  treasuryReleased: number
  monthlyBudget: number
  treasuryClaimedThisMonth: number
  feeVault: number
  feeCap: number
  feesClaimedThisMonth: number
  feesClaimedTotal: number
  holderReserve: number
  // founder lock
  vestMonths: number
  founderClaimed: number
  founderBurned: boolean
  // market
  volume24h: number
  volumeTotal: number
  history: number[]
  openPrice24h: number
  // wind-down
  refundPool: number
  refundPerToken: number
  woundDownAt?: number
}

export type AppStatus = 'submitted' | 'in_review' | 'scheduled' | 'rejected' | 'listed'
export interface Application {
  id: string
  mine: boolean
  founderName: string
  founderRole: string
  country: string
  email: string
  name: string
  ticker: string
  tagline: string
  about: string
  category: string
  website: string
  github: string
  social: string
  raiseTarget: number
  monthlyBudget: number
  feeCap: number
  checks: Checks
  status: AppStatus
  submittedAt: number
  scheduledFor?: number
  decidedAt?: number
  rejectionReason?: string
  startupId?: string
}

export interface Trade {
  id: string
  startupId: string
  side: 'buy' | 'sell' | 'commit'
  usdc: number
  tokens: number
  price: number
  ts: number
  wallet: string
  mine: boolean
}

export interface DayStat {
  date: string // yyyy-mm-dd
  volume: number
  trading: number
  verification: number
  graduation: number
}

export interface Holding {
  tokens: number
  cost: number
}

export interface Draft {
  step: number
  founderName: string
  founderRole: string
  country: string
  email: string
  name: string
  ticker: string
  tagline: string
  about: string
  category: string
  website: string
  github: string
  social: string
  raiseTarget: number
  monthlyBudget: number
  feeCap: number
  verified: Record<'kyc' | 'domain' | 'github' | 'socials', boolean>
  code: string
}

export type Result = { ok: true; message?: string } | { ok: false; error: string }
