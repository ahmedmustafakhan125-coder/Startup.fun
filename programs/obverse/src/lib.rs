pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

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
}
