use anchor_lang::prelude::*;
use anchor_spl::token::{
    self, spl_token::instruction::AuthorityType, Mint, MintTo, SetAuthority, Token, TokenAccount,
};

use crate::{
    constants::*,
    error::ObverseError,
    events::StartupListed,
    state::{Config, Heartbeat, Phase, Startup},
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateStartupArgs {
    pub ticker: String,
    pub founder: Pubkey,
    pub raise_target: u64,
    pub monthly_budget: u64,
    pub fee_cap: u64,
}

#[derive(Accounts)]
#[instruction(args: CreateStartupArgs)]
pub struct CreateStartup<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED], bump = config.bump,
        has_one = operator @ ObverseError::NotOperator,
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init, payer = operator, space = 8 + Startup::INIT_SPACE,
        seeds = [STARTUP_SEED, args.ticker.as_bytes()], bump,
    )]
    pub startup: Box<Account<'info, Startup>>,
    /// CHECK: PDA that owns every vault of this startup; it only signs.
    #[account(seeds = [VAULT_SEED, startup.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init, payer = operator, seeds = [MINT_SEED, startup.key().as_ref()], bump,
        mint::decimals = DECIMALS, mint::authority = vault_authority,
    )]
    pub mint: Box<Account<'info, Mint>>,

    #[account(init, payer = operator, seeds = [SALE_VAULT_SEED, startup.key().as_ref()], bump, token::mint = mint, token::authority = vault_authority)]
    pub sale_vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = operator, seeds = [POOL_TOKEN_SEED, startup.key().as_ref()], bump, token::mint = mint, token::authority = vault_authority)]
    pub pool_token: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = operator, seeds = [FOUNDER_LOCK_SEED, startup.key().as_ref()], bump, token::mint = mint, token::authority = vault_authority)]
    pub founder_lock: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = operator, seeds = [PLATFORM_LOCK_SEED, startup.key().as_ref()], bump, token::mint = mint, token::authority = vault_authority)]
    pub platform_lock: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_startup(ctx: Context<CreateStartup>, args: CreateStartupArgs) -> Result<()> {
    let ticker_ok = (TICKER_MIN_LEN..=TICKER_MAX_LEN).contains(&args.ticker.len())
        && args.ticker.bytes().all(|b| b.is_ascii_uppercase());
    require!(ticker_ok, ObverseError::InvalidTicker);
    require!(args.raise_target > 0, ObverseError::InvalidAmount);

    let startup_key = ctx.accounts.startup.key();
    let vault_bump = ctx.bumps.vault_authority;
    let signer: &[&[&[u8]]] = &[&[VAULT_SEED, startup_key.as_ref(), &[vault_bump]]];
    let token_program = ctx.accounts.token_program.key();

    // The liquidity allocation waits in pool_token; close_raise burns what the pool does not need.
    for (to, amount) in [
        (ctx.accounts.sale_vault.to_account_info(), SALE_SUPPLY),
        (ctx.accounts.pool_token.to_account_info(), LIQUIDITY_SUPPLY),
        (ctx.accounts.founder_lock.to_account_info(), FOUNDER_SUPPLY),
        (
            ctx.accounts.platform_lock.to_account_info(),
            PLATFORM_SUPPLY,
        ),
    ] {
        token::mint_to(
            CpiContext::new_with_signer(
                token_program,
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to,
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
    }
    // Supply can only go down from here.
    token::set_authority(
        CpiContext::new_with_signer(
            token_program,
            SetAuthority {
                current_authority: ctx.accounts.vault_authority.to_account_info(),
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
            signer,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    ctx.accounts.startup.set_inner(Startup {
        founder: args.founder,
        mint: ctx.accounts.mint.key(),
        ticker: args.ticker.clone(),
        phase: Phase::Raising,
        raise_target: args.raise_target,
        raised: 0,
        tokens_sold: 0,
        monthly_budget: args.monthly_budget,
        fee_cap: args.fee_cap,
        created_at: Clock::get()?.unix_timestamp,
        live_at: 0,
        heartbeat: Heartbeat::Green,
        last_beat: 0,
        red_since: 0,
        red_seconds_total: 0,
        last_treasury_period: 0,
        treasury_claimed_this_period: 0,
        last_fee_period: 0,
        fees_claimed_this_period: 0,
        founder_claimed: 0,
        platform_claimed: 0,
        refund_pool: 0,
        refund_circulating: 0,
        bump: ctx.bumps.startup,
        vault_bump,
        _reserved: [0; 256],
    });
    emit!(StartupListed {
        startup: startup_key,
        ticker: args.ticker,
        mint: ctx.accounts.mint.key(),
        founder: args.founder,
        raise_target: args.raise_target,
        monthly_budget: args.monthly_budget,
        fee_cap: args.fee_cap,
    });
    Ok(())
}

/// The startup's six USDC vaults. Split from `create_startup` because creating all twelve
/// accounts in one instruction overflows the 4 KB stack; the operator sends both in one transaction.
#[derive(Accounts)]
pub struct CreateStartupVaults<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED], bump = config.bump,
        has_one = operator @ ObverseError::NotOperator, has_one = usdc_mint,
    )]
    pub config: Box<Account<'info, Config>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(seeds = [STARTUP_SEED, startup.ticker.as_bytes()], bump = startup.bump)]
    pub startup: Box<Account<'info, Startup>>,
    /// CHECK: PDA that owns every vault of this startup; it only signs.
    #[account(seeds = [VAULT_SEED, startup.key().as_ref()], bump = startup.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(init, payer = operator, seeds = [RAISE_VAULT_SEED, startup.key().as_ref()], bump, token::mint = usdc_mint, token::authority = vault_authority)]
    pub raise_vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = operator, seeds = [TREASURY_VAULT_SEED, startup.key().as_ref()], bump, token::mint = usdc_mint, token::authority = vault_authority)]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = operator, seeds = [FEE_VAULT_SEED, startup.key().as_ref()], bump, token::mint = usdc_mint, token::authority = vault_authority)]
    pub fee_vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = operator, seeds = [RESERVE_VAULT_SEED, startup.key().as_ref()], bump, token::mint = usdc_mint, token::authority = vault_authority)]
    pub reserve_vault: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = operator, seeds = [POOL_USDC_SEED, startup.key().as_ref()], bump, token::mint = usdc_mint, token::authority = vault_authority)]
    pub pool_usdc: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = operator, seeds = [REFUND_VAULT_SEED, startup.key().as_ref()], bump, token::mint = usdc_mint, token::authority = vault_authority)]
    pub refund_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_startup_vaults(_ctx: Context<CreateStartupVaults>) -> Result<()> {
    Ok(())
}
