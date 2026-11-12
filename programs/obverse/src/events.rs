use anchor_lang::prelude::*;

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub platform_wallet: Pubkey,
    pub paused: bool,
}

#[event]
pub struct FaucetUsed {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ApplicationFeePaid {
    pub application_id: String,
    pub payer: Pubkey,
    pub amount: u64,
}

#[event]
pub struct StartupListed {
    pub startup: Pubkey,
    pub ticker: String,
    pub mint: Pubkey,
    pub founder: Pubkey,
    pub raise_target: u64,
    pub monthly_budget: u64,
    pub fee_cap: u64,
}

#[event]
pub struct Committed {
    pub startup: Pubkey,
    pub buyer: Pubkey,
    pub usdc_in: u64,
    pub tokens_out: u64,
    pub raised: u64,
}

#[event]
pub struct RaiseClosed {
    pub startup: Pubkey,
    pub raised: u64,
    pub listing_fee: u64,
    pub treasury: u64,
    pub pool_usdc: u64,
    pub pool_tokens: u64,
    pub burned: u64,
    pub live_at: i64,
}
