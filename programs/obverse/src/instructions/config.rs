use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{constants::*, error::ObverseError, events::ConfigUpdated, state::Config};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeConfigArgs {
    pub operator: Pubkey,
    pub platform_wallet: Pubkey,
    pub month_seconds: i64,
    pub winddown_seconds: i64,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    // shortcut: the first caller becomes admin, fine on devnet where the deploy script
    // initialises straight away; gate on the program's upgrade authority before real value.
    #[account(mut)]
    pub deployer: Signer<'info>,
    #[account(init, payer = deployer, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init, payer = deployer, seeds = [USDC_SEED], bump,
        mint::decimals = DECIMALS, mint::authority = config,
    )]
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init, payer = deployer, seeds = [INFRA_SEED], bump,
        token::mint = usdc_mint, token::authority = config,
    )]
    pub infra_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(
    ctx: Context<InitializeConfig>,
    args: InitializeConfigArgs,
) -> Result<()> {
    require!(
        args.month_seconds > 0 && args.winddown_seconds > 0,
        ObverseError::InvalidConfig
    );
    let config = &mut ctx.accounts.config;
    config.set_inner(Config {
        admin: ctx.accounts.deployer.key(),
        operator: args.operator,
        usdc_mint: ctx.accounts.usdc_mint.key(),
        platform_wallet: args.platform_wallet,
        trade_fee_bps: TRADE_FEE_BPS,
        platform_fee_bps: PLATFORM_FEE_BPS,
        startup_fee_bps: STARTUP_FEE_BPS,
        reserve_fee_bps: RESERVE_FEE_BPS,
        infra_fee_bps: INFRA_FEE_BPS,
        listing_fee_bps: LISTING_FEE_BPS,
        treasury_share_bps: TREASURY_SHARE_BPS,
        month_seconds: args.month_seconds,
        winddown_seconds: args.winddown_seconds,
        cliff_months: CLIFF_MONTHS,
        vest_months: VEST_MONTHS,
        verification_fee: VERIFICATION_FEE,
        paused: false,
        faucet_enabled: true,
        bump: ctx.bumps.config,
        _reserved: [0; 256],
    });
    emit_updated(config);
    Ok(())
}

/// Fee split, supply split and lock lengths are fixed rules and cannot be changed here.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateConfigArgs {
    pub admin: Option<Pubkey>,
    pub operator: Option<Pubkey>,
    pub platform_wallet: Option<Pubkey>,
    pub month_seconds: Option<i64>,
    pub winddown_seconds: Option<i64>,
    pub verification_fee: Option<u64>,
    pub paused: Option<bool>,
    pub faucet_enabled: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ObverseError::NotAdmin)]
    pub config: Account<'info, Config>,
}

pub fn handle_update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = args.admin.unwrap_or(config.admin);
    config.operator = args.operator.unwrap_or(config.operator);
    config.platform_wallet = args.platform_wallet.unwrap_or(config.platform_wallet);
    config.month_seconds = args.month_seconds.unwrap_or(config.month_seconds);
    config.winddown_seconds = args.winddown_seconds.unwrap_or(config.winddown_seconds);
    config.verification_fee = args.verification_fee.unwrap_or(config.verification_fee);
    config.paused = args.paused.unwrap_or(config.paused);
    config.faucet_enabled = args.faucet_enabled.unwrap_or(config.faucet_enabled);
    require!(
        config.month_seconds > 0 && config.winddown_seconds > 0,
        ObverseError::InvalidConfig
    );
    emit_updated(config);
    Ok(())
}

fn emit_updated(config: &Config) {
    emit!(ConfigUpdated {
        admin: config.admin,
        operator: config.operator,
        platform_wallet: config.platform_wallet,
        paused: config.paused,
    });
}
