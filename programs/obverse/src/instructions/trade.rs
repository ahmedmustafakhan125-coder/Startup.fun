use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::ObverseError,
    events::{Side, Traded},
    state::{mul_div, Config, Phase, Startup},
    vault::{transfer_from_user, Vault},
};

/// Accounts for both `buy` and `sell`.
#[derive(Accounts)]
pub struct Trade<'info> {
    pub trader: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [STARTUP_SEED, startup.ticker.as_bytes()], bump = startup.bump, has_one = mint)]
    pub startup: Box<Account<'info, Startup>>,
    /// CHECK: PDA that owns every vault of this startup; it only signs.
    #[account(seeds = [VAULT_SEED, startup.key().as_ref()], bump = startup.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = usdc_mint, token::authority = trader)]
    pub trader_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = trader)]
    pub trader_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_USDC_SEED, startup.key().as_ref()], bump)]
    pub pool_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_TOKEN_SEED, startup.key().as_ref()], bump)]
    pub pool_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [FEE_VAULT_SEED, startup.key().as_ref()], bump)]
    pub fee_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [RESERVE_VAULT_SEED, startup.key().as_ref()], bump)]
    pub reserve_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = config.platform_wallet)]
    pub platform_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [INFRA_SEED], bump)]
    pub infra_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// The four parts of a trade fee. The rounding remainder goes to the holder reserve.
struct FeeParts {
    platform: u64,
    startup: u64,
    reserve: u64,
    infra: u64,
}

fn split_fee(config: &Config, fee: u64) -> Result<FeeParts> {
    let total = config.trade_fee_bps as u64;
    let platform = mul_div(fee, config.platform_fee_bps as u64, total)?;
    let startup = mul_div(fee, config.startup_fee_bps as u64, total)?;
    let infra = mul_div(fee, config.infra_fee_bps as u64, total)?;
    Ok(FeeParts {
        platform,
        startup,
        infra,
        reserve: fee - platform - startup - infra,
    })
}

/// `a * b / c` in u128, rounded down, for products that do not fit `mul_div`.
fn wide_div(a: u128, b: u128, c: u128) -> Result<u64> {
    a.checked_mul(b)
        .and_then(|v| v.checked_div(c))
        .and_then(|v| u64::try_from(v).ok())
        .ok_or_else(|| error!(ObverseError::MathOverflow))
}

/// USDC per token scaled by 1e12, capped instead of failing so a trade never reverts over it.
fn price(pool_usdc: u64, pool_tokens: u64) -> u64 {
    (pool_usdc as u128 * 1_000_000_000_000)
        .checked_div(pool_tokens as u128)
        .map_or(0, |v| u64::try_from(v).unwrap_or(u64::MAX))
}

pub fn handle_buy(ctx: Context<Trade>, usdc_in: u64, min_tokens_out: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.paused, ObverseError::Paused);
    require!(a.startup.phase == Phase::Live, ObverseError::NotLive);
    require!(usdc_in > 0, ObverseError::InvalidAmount);
    require!(
        a.trader_usdc.amount >= usdc_in,
        ObverseError::InsufficientBalance
    );

    let (pool_usdc, pool_tokens) = (a.pool_usdc.amount, a.pool_token.amount);
    let fee_bps = a.config.trade_fee_bps as u64;
    // The fee rounds down, so the pool receives at least the exact net amount.
    let fee = mul_div(usdc_in, fee_bps, BPS)?;
    let net = usdc_in - fee;
    // tokens_out = pool_tokens * net / (pool_usdc + net), priced on the exact (unrounded) net
    // and rounded down: never more than curve.ts quotes.
    let net_scaled = usdc_in as u128 * (BPS - fee_bps) as u128;
    let tokens_out = wide_div(
        pool_tokens as u128,
        net_scaled,
        pool_usdc as u128 * BPS as u128 + net_scaled,
    )?;
    require!(tokens_out > 0, ObverseError::TradeTooSmall);
    require!(tokens_out >= min_tokens_out, ObverseError::SlippageExceeded);

    let parts = split_fee(&a.config, fee)?;
    let token_program = a.token_program.key();
    let (from, usdc_mint, trader) = (
        a.trader_usdc.to_account_info(),
        a.usdc_mint.to_account_info(),
        a.trader.to_account_info(),
    );
    for (to, amount) in [
        (a.pool_usdc.to_account_info(), net),
        (a.platform_usdc.to_account_info(), parts.platform),
        (a.fee_vault.to_account_info(), parts.startup),
        (a.reserve_vault.to_account_info(), parts.reserve),
        (a.infra_vault.to_account_info(), parts.infra),
    ] {
        transfer_from_user(token_program, &from, &usdc_mint, &to, &trader, amount)?;
    }
    Vault::new(&a.startup, &a.vault_authority, token_program).transfer(
        &a.pool_token.to_account_info(),
        &a.mint.to_account_info(),
        &a.trader_token.to_account_info(),
        tokens_out,
    )?;

    let (usdc_after, tokens_after) = (pool_usdc + net, pool_tokens - tokens_out);
    emit!(Traded {
        startup: a.startup.key(),
        trader: a.trader.key(),
        side: Side::Buy,
        usdc_amount: usdc_in,
        token_amount: tokens_out,
        fee,
        fee_platform: parts.platform,
        fee_startup: parts.startup,
        fee_reserve: parts.reserve,
        fee_infra: parts.infra,
        pool_usdc_after: usdc_after,
        pool_tokens_after: tokens_after,
        price_after: price(usdc_after, tokens_after),
    });
    Ok(())
}

/// Selling stays open while paused and while the heartbeat is red, so holders can always exit.
pub fn handle_sell(ctx: Context<Trade>, tokens_in: u64, min_usdc_out: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.startup.phase == Phase::Live, ObverseError::NotLive);
    require!(tokens_in > 0, ObverseError::InvalidAmount);
    require!(
        a.trader_token.amount >= tokens_in,
        ObverseError::InsufficientBalance
    );

    let (pool_usdc, pool_tokens) = (a.pool_usdc.amount, a.pool_token.amount);
    let fee_bps = a.config.trade_fee_bps as u64;
    let tokens_after = pool_tokens
        .checked_add(tokens_in)
        .ok_or(ObverseError::MathOverflow)?;
    // gross = pool_usdc * tokens_in / (pool_tokens + tokens_in), rounded down.
    let gross = mul_div(pool_usdc, tokens_in, tokens_after)?;
    // usdc_out is priced on the exact gross and rounded down; the fee takes the remainder.
    let usdc_out = wide_div(
        pool_usdc as u128 * tokens_in as u128,
        (BPS - fee_bps) as u128,
        tokens_after as u128 * BPS as u128,
    )?;
    let fee = gross - usdc_out;
    require!(usdc_out > 0, ObverseError::TradeTooSmall);
    require!(usdc_out >= min_usdc_out, ObverseError::SlippageExceeded);

    let parts = split_fee(&a.config, fee)?;
    let token_program = a.token_program.key();
    transfer_from_user(
        token_program,
        &a.trader_token.to_account_info(),
        &a.mint.to_account_info(),
        &a.pool_token.to_account_info(),
        &a.trader.to_account_info(),
        tokens_in,
    )?;
    let vault = Vault::new(&a.startup, &a.vault_authority, token_program);
    let (from, usdc_mint) = (a.pool_usdc.to_account_info(), a.usdc_mint.to_account_info());
    for (to, amount) in [
        (a.trader_usdc.to_account_info(), usdc_out),
        (a.platform_usdc.to_account_info(), parts.platform),
        (a.fee_vault.to_account_info(), parts.startup),
        (a.reserve_vault.to_account_info(), parts.reserve),
        (a.infra_vault.to_account_info(), parts.infra),
    ] {
        vault.transfer(&from, &usdc_mint, &to, amount)?;
    }

    let usdc_after = pool_usdc - gross;
    emit!(Traded {
        startup: a.startup.key(),
        trader: a.trader.key(),
        side: Side::Sell,
        usdc_amount: usdc_out,
        token_amount: tokens_in,
        fee,
        fee_platform: parts.platform,
        fee_startup: parts.startup,
        fee_reserve: parts.reserve,
        fee_infra: parts.infra,
        pool_usdc_after: usdc_after,
        pool_tokens_after: tokens_after,
        price_after: price(usdc_after, tokens_after),
    });
    Ok(())
}
