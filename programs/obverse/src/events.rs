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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Buy,
    Sell,
}

/// `usdc_amount` is what the trader paid (buy) or received (sell); the fee is on top of a sell's
/// payout and inside a buy's payment. `price_after` is USDC per token scaled by 1e12.
#[event]
pub struct Traded {
    pub startup: Pubkey,
    pub trader: Pubkey,
    pub side: Side,
    pub usdc_amount: u64,
    pub token_amount: u64,
    pub fee: u64,
    pub fee_platform: u64,
    pub fee_startup: u64,
    pub fee_reserve: u64,
    pub fee_infra: u64,
    pub pool_usdc_after: u64,
    pub pool_tokens_after: u64,
    pub price_after: u64,
}

#[event]
pub struct HeartbeatReported {
    pub startup: Pubkey,
    pub green: bool,
    pub at: i64,
}

#[event]
pub struct TreasuryClaimed {
    pub startup: Pubkey,
    pub amount: u64,
    pub period: u64,
}

#[event]
pub struct FeesClaimed {
    pub startup: Pubkey,
    pub amount: u64,
    pub period: u64,
}

#[event]
pub struct TokensClaimed {
    pub startup: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub platform: bool,
}

#[event]
pub struct WoundDown {
    pub startup: Pubkey,
    pub refund_pool: u64,
    pub circulating: u64,
}

#[event]
pub struct Refunded {
    pub startup: Pubkey,
    pub holder: Pubkey,
    pub tokens_burned: u64,
    pub usdc_paid: u64,
}
