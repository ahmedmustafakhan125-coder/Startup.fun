import { CLIFF_MONTHS, FEE, SUPPLY, VEST_MONTHS } from '../config'
import type { Startup } from '../store/types'

export const priceOf = (s: Startup) => {
  if (s.phase === 'raising') return s.salePrice
  if (s.phase === 'wound_down') return s.refundPerToken
  return s.poolTokens > 0 ? s.poolUsdc / s.poolTokens : 0
}
export const mcapOf = (s: Startup) => priceOf(s) * SUPPLY.total
export const change24h = (s: Startup) => (s.phase === 'live' && s.openPrice24h > 0 ? priceOf(s) / s.openPrice24h - 1 : 0)

export function quoteBuy(s: Startup, usdcIn: number) {
  const fee = usdcIn * FEE.total
  const net = usdcIn - fee
  const k = s.poolUsdc * s.poolTokens
  const tokensOut = s.poolTokens - k / (s.poolUsdc + net)
  const avg = tokensOut > 0 ? usdcIn / tokensOut : 0
  const impact = priceOf(s) > 0 && tokensOut > 0 ? net / tokensOut / priceOf(s) - 1 : 0
  return { fee, net, tokensOut, avg, impact }
}

export function quoteSell(s: Startup, tokensIn: number) {
  const k = s.poolUsdc * s.poolTokens
  const gross = s.poolUsdc - k / (s.poolTokens + tokensIn)
  const fee = gross * FEE.total
  const usdcOut = gross - fee
  const impact = priceOf(s) > 0 && tokensIn > 0 ? 1 - gross / tokensIn / priceOf(s) : 0
  return { fee, gross, usdcOut, impact }
}

export const feeParts = (fee: number) => ({
  infra: (fee * FEE.infra) / FEE.total,
  platform: (fee * FEE.platform) / FEE.total,
  startup: (fee * FEE.startup) / FEE.total,
  reserve: (fee * FEE.reserve) / FEE.total,
})

// Money a founder can take right now. Everything is zero while the heartbeat is red.
export const claimableTreasury = (s: Startup) =>
  s.phase === 'live' && s.heartbeat === 'green'
    ? Math.max(0, Math.min(s.treasury, s.monthlyBudget - s.treasuryClaimedThisMonth))
    : 0
export const claimableFees = (s: Startup) =>
  s.phase === 'live' && s.heartbeat === 'green'
    ? Math.max(0, Math.min(s.feeVault, s.feeCap - s.feesClaimedThisMonth))
    : 0
export const vestedTokens = (s: Startup) =>
  s.founderBurned ? 0 : SUPPLY.founders * Math.min(1, Math.max(0, (s.vestMonths - CLIFF_MONTHS) / VEST_MONTHS))
export const founderClaimable = (s: Startup) =>
  s.phase === 'live' && s.heartbeat === 'green' ? Math.max(0, vestedTokens(s) - s.founderClaimed) : 0

// What holders would get back per token if the startup wound down today.
export const floorPool = (s: Startup) => s.treasury + s.feeVault + s.holderReserve + s.poolUsdc
export const floorPerToken = (s: Startup) => (s.circulating > 0 ? floorPool(s) / s.circulating : 0)
export const runwayMonths = (s: Startup) => (s.monthlyBudget > 0 ? s.treasury / s.monthlyBudget : 0)
