use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::ObverseError,
    events::{FeesClaimed, HeartbeatReported, TokensClaimed, TreasuryClaimed},
    state::{mul_div, Config, Heartbeat, Phase, Startup},
    vault::Vault,
};

#[derive(Accounts)]
pub struct ReportHeartbeat<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ ObverseError::NotOperator)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [STARTUP_SEED, startup.ticker.as_bytes()], bump = startup.bump)]
    pub startup: Account<'info, Startup>,
}

pub fn handle_report_heartbeat(ctx: Context<ReportHeartbeat>, status: Heartbeat) -> Result<()> {
    let startup = &mut ctx.accounts.startup;
    require!(startup.phase == Phase::Live, ObverseError::NotLive);
    let now = Clock::get()?.unix_timestamp;
    match (startup.heartbeat, status) {
        (Heartbeat::Green, Heartbeat::Red) => startup.red_since = now,
        (Heartbeat::Red, Heartbeat::Green) => {
            startup.red_seconds_total = startup
                .red_seconds_total
                .saturating_add(now.saturating_sub(startup.red_since));
            startup.red_since = 0;
        }
        _ => {} // a repeated Red keeps the original red_since
    }
    if status == Heartbeat::Green {
        startup.last_beat = now;
    }
    startup.heartbeat = status;
    emit!(HeartbeatReported {
        startup: startup.key(),
        green: status == Heartbeat::Green,
        at: now
    });
    Ok(())
}

/// Phase first, then heartbeat (ARCHITECTURE.md 4.4). Every claim goes through this.
fn require_claims_open(config: &Config, startup: &Startup) -> Result<()> {
    require!(!config.paused, ObverseError::Paused);
    require!(startup.phase == Phase::Live, ObverseError::NotLive);
    require!(
        startup.heartbeat == Heartbeat::Green,
        ObverseError::HeartbeatRed
    );
    Ok(())
}

/// What a capped claim pays this period. Unused budget does not carry over.
fn capped_claim(
    last_period: &mut u64,
    claimed: &mut u64,
    period: u64,
    cap: u64,
    balance: u64,
) -> Result<u64> {
    if period > *last_period {
        *last_period = period;
        *claimed = 0;
    }
    let amount = balance.min(cap.saturating_sub(*claimed));
    require!(amount > 0, ObverseError::NothingToClaim);
    *claimed += amount; // cannot overflow: amount <= cap - claimed
    Ok(amount)
}

/// Accounts for both `claim_treasury` and `claim_fees`.
#[derive(Accounts)]
pub struct FounderClaim<'info> {
    pub founder: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut, seeds = [STARTUP_SEED, startup.ticker.as_bytes()], bump = startup.bump,
        has_one = founder @ ObverseError::NotFounder,
    )]
    pub startup: Box<Account<'info, Startup>>,
    /// CHECK: PDA that owns every vault of this startup; it only signs.
    #[account(seeds = [VAULT_SEED, startup.key().as_ref()], bump = startup.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [TREASURY_VAULT_SEED, startup.key().as_ref()], bump)]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [FEE_VAULT_SEED, startup.key().as_ref()], bump)]
    pub fee_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = founder)]
    pub founder_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

impl<'info> FounderClaim<'info> {
    fn period(&self) -> Result<u64> {
        let since_live = Clock::get()?
            .unix_timestamp
            .saturating_sub(self.startup.live_at)
            .max(0);
        Ok((since_live / self.config.month_seconds) as u64)
    }

    fn pay(&self, from: &Account<'info, TokenAccount>, amount: u64) -> Result<()> {
        Vault::new(
            &self.startup,
            &self.vault_authority,
            self.token_program.key(),
        )
        .transfer(
            &from.to_account_info(),
            &self.usdc_mint.to_account_info(),
            &self.founder_usdc.to_account_info(),
            amount,
        )
    }
}

pub fn handle_claim_treasury(ctx: Context<FounderClaim>) -> Result<()> {
    let a = ctx.accounts;
    require_claims_open(&a.config, &a.startup)?;
    let period = a.period()?;
    let (cap, balance) = (a.startup.monthly_budget, a.treasury_vault.amount);
    let s: &mut Startup = &mut a.startup;
    let amount = capped_claim(
        &mut s.last_treasury_period,
        &mut s.treasury_claimed_this_period,
        period,
        cap,
        balance,
    )?;
    a.pay(&a.treasury_vault, amount)?;
    emit!(TreasuryClaimed {
        startup: a.startup.key(),
        amount,
        period
    });
    Ok(())
}

pub fn handle_claim_fees(ctx: Context<FounderClaim>) -> Result<()> {
    let a = ctx.accounts;
    require_claims_open(&a.config, &a.startup)?;
    let period = a.period()?;
    let (cap, balance) = (a.startup.fee_cap, a.fee_vault.amount);
    let s: &mut Startup = &mut a.startup;
    let amount = capped_claim(
        &mut s.last_fee_period,
        &mut s.fees_claimed_this_period,
        period,
        cap,
        balance,
    )?;
    a.pay(&a.fee_vault, amount)?;
    emit!(FeesClaimed {
        startup: a.startup.key(),
        amount,
        period
    });
    Ok(())
}

/// Tokens released so far from a locked allocation. Only green time counts.
fn vested(config: &Config, startup: &Startup, allocation: u64) -> Result<u64> {
    let now = Clock::get()?.unix_timestamp;
    let mut green = now
        .saturating_sub(startup.live_at)
        .saturating_sub(startup.red_seconds_total);
    if startup.heartbeat == Heartbeat::Red {
        green = green.saturating_sub(now.saturating_sub(startup.red_since));
    }
    let months = (green.max(0) / config.month_seconds) as u64;
    let vest_months = config.vest_months as u64;
    let past_cliff = months
        .saturating_sub(config.cliff_months as u64)
        .min(vest_months);
    mul_div(allocation, past_cliff, vest_months)
}

#[derive(Accounts)]
pub struct ClaimFounderTokens<'info> {
    pub founder: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut, seeds = [STARTUP_SEED, startup.ticker.as_bytes()], bump = startup.bump,
        has_one = founder @ ObverseError::NotFounder, has_one = mint,
    )]
    pub startup: Box<Account<'info, Startup>>,
    /// CHECK: PDA that owns every vault of this startup; it only signs.
    #[account(seeds = [VAULT_SEED, startup.key().as_ref()], bump = startup.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [FOUNDER_LOCK_SEED, startup.key().as_ref()], bump)]
    pub founder_lock: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = founder)]
    pub founder_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_founder_tokens(ctx: Context<ClaimFounderTokens>) -> Result<()> {
    let a = ctx.accounts;
    require_claims_open(&a.config, &a.startup)?;
    let amount =
        vested(&a.config, &a.startup, FOUNDER_SUPPLY)?.saturating_sub(a.startup.founder_claimed);
    require!(amount > 0, ObverseError::NothingToClaim);
    Vault::new(&a.startup, &a.vault_authority, a.token_program.key()).transfer(
        &a.founder_lock.to_account_info(),
        &a.mint.to_account_info(),
        &a.founder_token.to_account_info(),
        amount,
    )?;
    a.startup.founder_claimed += amount; // cannot overflow: bounded by FOUNDER_SUPPLY
    emit!(TokensClaimed {
        startup: a.startup.key(),
        recipient: a.founder.key(),
        amount,
        platform: false
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimPlatformTokens<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ObverseError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [STARTUP_SEED, startup.ticker.as_bytes()], bump = startup.bump, has_one = mint)]
    pub startup: Box<Account<'info, Startup>>,
    /// CHECK: PDA that owns every vault of this startup; it only signs.
    #[account(seeds = [VAULT_SEED, startup.key().as_ref()], bump = startup.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [PLATFORM_LOCK_SEED, startup.key().as_ref()], bump)]
    pub platform_lock: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = config.platform_wallet)]
    pub platform_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_platform_tokens(ctx: Context<ClaimPlatformTokens>) -> Result<()> {
    let a = ctx.accounts;
    require_claims_open(&a.config, &a.startup)?;
    let amount =
        vested(&a.config, &a.startup, PLATFORM_SUPPLY)?.saturating_sub(a.startup.platform_claimed);
    require!(amount > 0, ObverseError::NothingToClaim);
    Vault::new(&a.startup, &a.vault_authority, a.token_program.key()).transfer(
        &a.platform_lock.to_account_info(),
        &a.mint.to_account_info(),
        &a.platform_token.to_account_info(),
        amount,
    )?;
    a.startup.platform_claimed += amount; // cannot overflow: bounded by PLATFORM_SUPPLY
    emit!(TokensClaimed {
        startup: a.startup.key(),
        recipient: a.config.platform_wallet,
        amount,
        platform: true,
    });
    Ok(())
}
