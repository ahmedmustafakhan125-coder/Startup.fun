pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod vault;

use anchor_lang::prelude::*;

use crate::state::Heartbeat;

pub use instructions::*;

declare_id!("3m3j9sLeNffS1cG6RVWwb5SLNXUvBp3wtoG3u6CZrjQx");

/// Obverse program. Rules and formulas: ARCHITECTURE.md section 4.
#[program]
pub mod obverse {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        crate::instructions::config::handle_initialize_config(ctx, args)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        crate::instructions::config::handle_update_config(ctx, args)
    }

    pub fn faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
        crate::instructions::usdc::handle_faucet(ctx, amount)
    }

    pub fn pay_verification_fee(
        ctx: Context<PayVerificationFee>,
        application_id: String,
    ) -> Result<()> {
        crate::instructions::usdc::handle_pay_verification_fee(ctx, application_id)
    }

    pub fn create_startup(ctx: Context<CreateStartup>, args: CreateStartupArgs) -> Result<()> {
        crate::instructions::create_startup::handle_create_startup(ctx, args)
    }

    pub fn create_startup_vaults(ctx: Context<CreateStartupVaults>) -> Result<()> {
        crate::instructions::create_startup::handle_create_startup_vaults(ctx)
    }

    pub fn commit(ctx: Context<Commit>, usdc_in: u64) -> Result<()> {
        crate::instructions::raise::handle_commit(ctx, usdc_in)
    }

    pub fn close_raise(ctx: Context<CloseRaise>) -> Result<()> {
        crate::instructions::raise::handle_close_raise(ctx)
    }

    pub fn buy(ctx: Context<Trade>, usdc_in: u64, min_tokens_out: u64) -> Result<()> {
        crate::instructions::trade::handle_buy(ctx, usdc_in, min_tokens_out)
    }

    pub fn sell(ctx: Context<Trade>, tokens_in: u64, min_usdc_out: u64) -> Result<()> {
        crate::instructions::trade::handle_sell(ctx, tokens_in, min_usdc_out)
    }

    pub fn report_heartbeat(ctx: Context<ReportHeartbeat>, status: Heartbeat) -> Result<()> {
        crate::instructions::payouts::handle_report_heartbeat(ctx, status)
    }

    pub fn claim_treasury(ctx: Context<FounderClaim>) -> Result<()> {
        crate::instructions::payouts::handle_claim_treasury(ctx)
    }

    pub fn claim_fees(ctx: Context<FounderClaim>) -> Result<()> {
        crate::instructions::payouts::handle_claim_fees(ctx)
    }

    pub fn claim_founder_tokens(ctx: Context<ClaimFounderTokens>) -> Result<()> {
        crate::instructions::payouts::handle_claim_founder_tokens(ctx)
    }

    pub fn claim_platform_tokens(ctx: Context<ClaimPlatformTokens>) -> Result<()> {
        crate::instructions::payouts::handle_claim_platform_tokens(ctx)
    }

    pub fn wind_down(ctx: Context<WindDown>) -> Result<()> {
        crate::instructions::wind_down::handle_wind_down(ctx)
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>, amount: u64) -> Result<()> {
        crate::instructions::wind_down::handle_claim_refund(ctx, amount)
    }
}
