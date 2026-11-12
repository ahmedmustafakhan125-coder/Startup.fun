use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::ObverseError,
    events::{Committed, RaiseClosed},
    state::{mul_div, Config, Heartbeat, Phase, Startup},
};

#[derive(Accounts)]
pub struct Commit<'info> {
    pub buyer: Signer<'info>,
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
    #[account(mut, token::mint = usdc_mint, token::authority = buyer)]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [RAISE_VAULT_SEED, startup.key().as_ref()], bump)]
    pub raise_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SALE_VAULT_SEED, startup.key().as_ref()], bump)]
    pub sale_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_TOKEN_SEED, startup.key().as_ref()], bump)]
    pub pool_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_USDC_SEED, startup.key().as_ref()], bump)]
    pub pool_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [TREASURY_VAULT_SEED, startup.key().as_ref()], bump)]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = config.platform_wallet)]
    pub platform_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_commit(ctx: Context<Commit>, usdc_in: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, ObverseError::Paused);
    let startup = &ctx.accounts.startup;
    require!(startup.phase == Phase::Raising, ObverseError::RaiseClosed);
    // Clamp to the remaining room, as the frontend does. Room is never zero while Raising.
    let usdc_in = usdc_in.min(startup.raise_target - startup.raised);
    require!(usdc_in > 0, ObverseError::InvalidAmount);
    let tokens_out = mul_div(usdc_in, SALE_SUPPLY, startup.raise_target)?;
    require!(tokens_out > 0, ObverseError::CommitTooSmall);

    let token_program = ctx.accounts.token_program.key();
    token::transfer_checked(
        CpiContext::new(
            token_program,
            TransferChecked {
                from: ctx.accounts.buyer_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.raise_vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        usdc_in,
        DECIMALS,
    )?;
    let raise = RaiseAccounts {
        config: &ctx.accounts.config,
        vault_authority: ctx.accounts.vault_authority.to_account_info(),
        usdc_mint: ctx.accounts.usdc_mint.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        raise_vault: ctx.accounts.raise_vault.to_account_info(),
        sale_vault: ctx.accounts.sale_vault.to_account_info(),
        pool_token: ctx.accounts.pool_token.to_account_info(),
        pool_usdc: ctx.accounts.pool_usdc.to_account_info(),
        treasury_vault: ctx.accounts.treasury_vault.to_account_info(),
        platform_usdc: ctx.accounts.platform_usdc.to_account_info(),
        token_program,
    };
    let startup = &mut ctx.accounts.startup;
    raise.transfer(
        startup,
        &raise.sale_vault,
        &raise.mint,
        &ctx.accounts.buyer_token.to_account_info(),
        tokens_out,
    )?;

    startup.raised += usdc_in; // cannot overflow: clamped to raise_target above
    startup.tokens_sold += tokens_out;
    emit!(Committed {
        startup: startup.key(),
        buyer: ctx.accounts.buyer.key(),
        usdc_in,
        tokens_out,
        raised: startup.raised,
    });
    if startup.raised == startup.raise_target {
        raise.close(startup)?;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CloseRaise<'info> {
    pub operator: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED], bump = config.bump,
        has_one = operator @ ObverseError::NotOperator, has_one = usdc_mint,
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [STARTUP_SEED, startup.ticker.as_bytes()], bump = startup.bump, has_one = mint)]
    pub startup: Box<Account<'info, Startup>>,
    /// CHECK: PDA that owns every vault of this startup; it only signs.
    #[account(seeds = [VAULT_SEED, startup.key().as_ref()], bump = startup.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [RAISE_VAULT_SEED, startup.key().as_ref()], bump)]
    pub raise_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SALE_VAULT_SEED, startup.key().as_ref()], bump)]
    pub sale_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_TOKEN_SEED, startup.key().as_ref()], bump)]
    pub pool_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [POOL_USDC_SEED, startup.key().as_ref()], bump)]
    pub pool_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [TREASURY_VAULT_SEED, startup.key().as_ref()], bump)]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = config.platform_wallet)]
    pub platform_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_close_raise(ctx: Context<CloseRaise>) -> Result<()> {
    let startup = &mut ctx.accounts.startup;
    require!(startup.phase == Phase::Raising, ObverseError::RaiseClosed);
    require!(startup.raised > 0, ObverseError::NothingCommitted);
    RaiseAccounts {
        config: &ctx.accounts.config,
        vault_authority: ctx.accounts.vault_authority.to_account_info(),
        usdc_mint: ctx.accounts.usdc_mint.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        raise_vault: ctx.accounts.raise_vault.to_account_info(),
        sale_vault: ctx.accounts.sale_vault.to_account_info(),
        pool_token: ctx.accounts.pool_token.to_account_info(),
        pool_usdc: ctx.accounts.pool_usdc.to_account_info(),
        treasury_vault: ctx.accounts.treasury_vault.to_account_info(),
        platform_usdc: ctx.accounts.platform_usdc.to_account_info(),
        token_program: ctx.accounts.token_program.key(),
    }
    .close(startup)
}

/// The accounts both `commit` (automatic close at target) and `close_raise` need.
struct RaiseAccounts<'a, 'info> {
    config: &'a Config,
    vault_authority: AccountInfo<'info>,
    usdc_mint: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    raise_vault: AccountInfo<'info>,
    sale_vault: AccountInfo<'info>,
    pool_token: AccountInfo<'info>,
    pool_usdc: AccountInfo<'info>,
    treasury_vault: AccountInfo<'info>,
    platform_usdc: AccountInfo<'info>,
    token_program: Pubkey,
}

impl<'info> RaiseAccounts<'_, 'info> {
    /// Vault-signed transfer out of one of the startup's token accounts.
    fn transfer(
        &self,
        startup: &Account<'info, Startup>,
        from: &AccountInfo<'info>,
        mint: &AccountInfo<'info>,
        to: &AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        let key = startup.key();
        token::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program,
                TransferChecked {
                    from: from.clone(),
                    mint: mint.clone(),
                    to: to.clone(),
                    authority: self.vault_authority.clone(),
                },
                &[&[VAULT_SEED, key.as_ref(), &[startup.vault_bump]]],
            ),
            amount,
            DECIMALS,
        )
    }

    fn burn(
        &self,
        startup: &Account<'info, Startup>,
        from: &AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        let key = startup.key();
        token::burn(
            CpiContext::new_with_signer(
                self.token_program,
                Burn {
                    mint: self.mint.clone(),
                    from: from.clone(),
                    authority: self.vault_authority.clone(),
                },
                &[&[VAULT_SEED, key.as_ref(), &[startup.vault_bump]]],
            ),
            amount,
        )
    }

    /// ARCHITECTURE.md 4.3 "Closing a raise". Everything paid out rounds down; the treasury keeps the rest.
    fn close(&self, startup: &mut Account<'info, Startup>) -> Result<()> {
        let raised = startup.raised;
        let listing_fee = mul_div(raised, self.config.listing_fee_bps as u64, BPS)?;
        let net = raised - listing_fee;
        let pool_usdc = mul_div(net, BPS - self.config.treasury_share_bps as u64, BPS)?;
        let treasury = net - pool_usdc;
        // The pool opens at the raise price.
        let pool_tokens =
            mul_div(pool_usdc, SALE_SUPPLY, startup.raise_target)?.min(LIQUIDITY_SUPPLY);
        let unsold = SALE_SUPPLY - startup.tokens_sold;
        let unused = LIQUIDITY_SUPPLY - pool_tokens;

        self.transfer(
            startup,
            &self.raise_vault,
            &self.usdc_mint,
            &self.platform_usdc,
            listing_fee,
        )?;
        self.transfer(
            startup,
            &self.raise_vault,
            &self.usdc_mint,
            &self.pool_usdc,
            pool_usdc,
        )?;
        self.transfer(
            startup,
            &self.raise_vault,
            &self.usdc_mint,
            &self.treasury_vault,
            treasury,
        )?;
        self.burn(startup, &self.sale_vault, unsold)?;
        self.burn(startup, &self.pool_token, unused)?;

        let now = Clock::get()?.unix_timestamp;
        startup.phase = Phase::Live;
        startup.heartbeat = Heartbeat::Green;
        startup.live_at = now;
        startup.last_beat = now;
        emit!(RaiseClosed {
            startup: startup.key(),
            raised,
            listing_fee,
            treasury,
            pool_usdc,
            pool_tokens,
            burned: unsold + unused,
            live_at: now,
        });
        Ok(())
    }
}
