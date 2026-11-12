use anchor_lang::prelude::*;

use crate::error::ObverseError;

/// Seeds: ["config"]. Also the authority of the demo USDC mint and the infra vault.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub usdc_mint: Pubkey,
    pub platform_wallet: Pubkey,
    pub trade_fee_bps: u16,
    pub platform_fee_bps: u16,
    pub startup_fee_bps: u16,
    pub reserve_fee_bps: u16,
    pub infra_fee_bps: u16,
    pub listing_fee_bps: u16,
    pub treasury_share_bps: u16,
    pub month_seconds: i64,
    pub winddown_seconds: i64,
    pub cliff_months: u16,
    pub vest_months: u16,
    pub verification_fee: u64,
    pub paused: bool,
    pub faucet_enabled: bool,
    pub bump: u8,
    /// Room for new fields without resizing (ARCHITECTURE.md 4.1, account sizing).
    pub _reserved: [u8; 256],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Phase {
    Raising,
    Live,
    WoundDown,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Heartbeat {
    Green,
    Red,
}

/// Seeds: ["startup", ticker]. Fields below `live_at` are used from Phase 2 and 3.
#[account]
#[derive(InitSpace)]
pub struct Startup {
    pub founder: Pubkey,
    pub mint: Pubkey,
    #[max_len(16)]
    pub ticker: String,
    pub phase: Phase,
    pub raise_target: u64,
    pub raised: u64,
    pub tokens_sold: u64,
    pub monthly_budget: u64,
    pub fee_cap: u64,
    pub created_at: i64,
    pub live_at: i64,
    pub heartbeat: Heartbeat,
    pub last_beat: i64,
    pub red_since: i64,
    pub red_seconds_total: i64,
    pub last_treasury_period: u64,
    pub treasury_claimed_this_period: u64,
    pub last_fee_period: u64,
    pub fees_claimed_this_period: u64,
    pub founder_claimed: u64,
    pub platform_claimed: u64,
    pub refund_pool: u64,
    pub refund_circulating: u64,
    pub bump: u8,
    pub vault_bump: u8,
    /// Room for new fields without resizing (ARCHITECTURE.md 4.1, account sizing).
    pub _reserved: [u8; 256],
}

/// `a * b / c` with a u128 intermediate, rounded down.
pub fn mul_div(a: u64, b: u64, c: u64) -> Result<u64> {
    (a as u128)
        .checked_mul(b as u128)
        .and_then(|v| v.checked_div(c as u128))
        .and_then(|v| u64::try_from(v).ok())
        .ok_or_else(|| error!(ObverseError::MathOverflow))
}
