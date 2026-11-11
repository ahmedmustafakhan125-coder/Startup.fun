// One place for every number and name the product depends on.
// Change BRAND to rename the product everywhere.
export const BRAND = 'Obverse'
export const NETWORK = 'Devnet'

export const SUPPLY = {
  total: 100_000_000,
  sale: 65_000_000, // sold in the raise
  liquidity: 13_000_000, // paired with 20% of proceeds when trading opens
  founders: 20_000_000,
  platform: 2_000_000,
}

// 1% per trade, split four ways.
export const FEE = {
  total: 0.01,
  infra: 0.002, // Meteora protocol share
  platform: 0.003,
  startup: 0.003, // goes to the startup's fee vault, claimable up to a monthly cap
  reserve: 0.002, // holder reserve, refunded on wind-down
}

export const VERIFICATION_FEE = 300 // USDC, paid when an application is submitted
export const GRADUATION_FEE = 0.025 // share of a closed raise
export const TREASURY_SHARE = 0.8 // rest of the proceeds seeds liquidity
export const CLIFF_MONTHS = 12
export const VEST_MONTHS = 24
export const WINDDOWN_DAYS = 60
export const REVIEW_MIN_DAYS = 7
export const REVIEW_MAX_DAYS = 14
export const DEMO_AIRDROP = 5_000
export const DEMO_ADDRESS = 'DEMo9fQ2hYt7mJc4W8sZkR1pXvB6nLuA3eT5gKyHdNwq'

export const CATEGORIES = ['AI', 'Fintech', 'Developer tools', 'Logistics', 'Climate', 'Health', 'Consumer', 'Other']

// Chart colours, validated for the dark surface with the dataviz palette checker.
export const CHART = {
  series: '#6EA2FF',
  cat: ['#3F7FEA', '#789C1D', '#9B63E8', '#C8802A'],
}
