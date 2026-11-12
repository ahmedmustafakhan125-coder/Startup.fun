use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::ObverseError,
    events::{Refunded, WoundDown},
    state::{mul_div, Config, Heartbeat, Phase, Startup},
    vault::Vault,
};

#[derive(Accounts)]
pub struct WindDown<'info> {
    /// Anyone can wind a startup down once the conditions hold.
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [STARTUP_SEED, startup.ticker.as_bytes()], bump = startup.bump, has_one = mint)]
    pub startup: Box<Account<'info, Startup>>,
    /// CHECK: PDA that owns every vault of this startup; it only signs.
    #[account(seeds = [VAULT_SEED, startup.key().as_ref()], bump = startup.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [TREASURY_VAULT_SEED, startup.key().as_ref()], bump)]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [FEE_VAULT_SEED, startup.key().as_ref()], bump)]
    pub fee_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [RESERVE_VAULT_SEED, startup.key().as_ref()], bump)]
    pub reserve_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_USDC_SEED, startup.key().as_ref()], bump)]
    pub pool_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [REFUND_VAULT_SEED, startup.key().as_ref()], bump)]
    pub refund_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [FOUNDER_LOCK_SEED, startup.key().as_ref()], bump)]
    pub founder_lock: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [PLATFORM_LOCK_SEED, startup.key().as_ref()], bump)]
    pub platform_lock: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_TOKEN_SEED, startup.key().as_ref()], bump)]
    pub pool_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_wind_down(ctx: Context<WindDown>) -> Result<()> {
    let a = ctx.accounts;
    require!(a.startup.phase == Phase::Live, ObverseError::NotLive);
    require!(
        a.startup.heartbeat == Heartbeat::Red,
        ObverseError::HeartbeatGreen
    );
    let red_for = Clock::get()?
        .unix_timestamp
        .saturating_sub(a.startup.red_since);
    require!(
        red_for >= a.config.winddown_seconds,
        ObverseError::WinddownTooEarly
    );

    let vault = Vault::new(&a.startup, &a.vault_authority, a.token_program.key());
    let (usdc_mint, mint, refund_vault) = (
        a.usdc_mint.to_account_info(),
        a.mint.to_account_info(),
        a.refund_vault.to_account_info(),
    );
    let mut refund_pool = a.refund_vault.amount;
    for from in [
        &a.treasury_vault,
        &a.fee_vault,
        &a.reserve_vault,
        &a.pool_usdc,
    ] {
        vault.transfer(
            &from.to_account_info(),
            &usdc_mint,
            &refund_vault,
            from.amount,
        )?;
        refund_pool = refund_pool
            .checked_add(from.amount)
            .ok_or(ObverseError::MathOverflow)?;
    }
    let mut circulating = a.mint.supply;
    for from in [&a.founder_lock, &a.platform_lock, &a.pool_token] {
        vault.burn(&from.to_account_info(), &mint, from.amount)?;
        circulating -= from.amount; // cannot underflow: the balance is part of the supply
    }

    let startup = &mut a.startup;
    startup.phase = Phase::WoundDown;
    startup.refund_pool = refund_pool;
    startup.refund_circulating = circulating;
    emit!(WoundDown {
        startup: startup.key(),
        refund_pool,
        circulating
    });
    Ok(())
}

/// Never blocked by `paused`: holders can always take their refund.
#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    pub holder: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [STARTUP_SEED, startup.ticker.as_bytes()], bump = startup.bump, has_one = mint)]
    pub startup: Box<Account<'info, Startup>>,
    /// CHECK: PDA that owns every vault of this startup; it only signs.
    #[account(seeds = [VAULT_SEED, startup.key().as_ref()], bump = startup.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = holder)]
    pub holder_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = holder)]
    pub holder_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [REFUND_VAULT_SEED, startup.key().as_ref()], bump)]
    pub refund_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_refund(ctx: Context<ClaimRefund>, amount: u64) -> Result<()> {
    let a = ctx.accounts;
    require!(
        a.startup.phase == Phase::WoundDown,
        ObverseError::NotWoundDown
    );
    require!(amount > 0, ObverseError::InvalidAmount);
    require!(
        a.holder_token.amount >= amount,
        ObverseError::InsufficientBalance
    );
    // Rounded down, so the vault can always pay the last holder.
    let usdc_paid = mul_div(amount, a.startup.refund_pool, a.startup.refund_circulating)?;

    token::burn(
        CpiContext::new(
            a.token_program.key(),
            Burn {
                mint: a.mint.to_account_info(),
                from: a.holder_token.to_account_info(),
                authority: a.holder.to_account_info(),
            },
        ),
        amount,
    )?;
    Vault::new(&a.startup, &a.vault_authority, a.token_program.key()).transfer(
        &a.refund_vault.to_account_info(),
        &a.usdc_mint.to_account_info(),
        &a.holder_usdc.to_account_info(),
        usdc_paid,
    )?;
    emit!(Refunded {
        startup: a.startup.key(),
        holder: a.holder.key(),
        tokens_burned: amount,
        usdc_paid
    });
    Ok(())
}
