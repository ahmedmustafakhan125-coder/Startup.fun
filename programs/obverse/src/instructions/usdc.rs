use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::ObverseError,
    events::{ApplicationFeePaid, FaucetUsed},
    state::Config,
};

#[derive(Accounts)]
pub struct Faucet<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub usdc_mint: Account<'info, Mint>,
    #[account(mut, token::mint = usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(config.faucet_enabled, ObverseError::FaucetDisabled);
    require!(amount > 0, ObverseError::InvalidAmount);
    require!(amount <= FAUCET_MAX, ObverseError::FaucetCapExceeded);
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.user_usdc.to_account_info(),
                authority: config.to_account_info(),
            },
            &[&[CONFIG_SEED, &[config.bump]]],
        ),
        amount,
    )?;
    emit!(FaucetUsed {
        user: ctx.accounts.user.key(),
        amount
    });
    Ok(())
}

#[derive(Accounts)]
pub struct PayVerificationFee<'info> {
    pub founder: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(mut, token::mint = usdc_mint, token::authority = founder)]
    pub founder_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, token::authority = config.platform_wallet)]
    pub platform_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_pay_verification_fee(
    ctx: Context<PayVerificationFee>,
    application_id: String,
) -> Result<()> {
    require!(
        application_id.len() <= APPLICATION_ID_MAX_LEN,
        ObverseError::ApplicationIdTooLong
    );
    let amount = ctx.accounts.config.verification_fee;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.founder_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.platform_usdc.to_account_info(),
                authority: ctx.accounts.founder.to_account_info(),
            },
        ),
        amount,
        DECIMALS,
    )?;
    emit!(ApplicationFeePaid {
        application_id,
        payer: ctx.accounts.founder.key(),
        amount
    });
    Ok(())
}
