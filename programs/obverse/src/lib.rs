pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;

declare_id!("3m3j9sLeNffS1cG6RVWwb5SLNXUvBp3wtoG3u6CZrjQx");

/// Obverse program. Phase 0 scaffold: the real instructions arrive in Phases 1 to 3
/// (see ARCHITECTURE.md section 4).
#[program]
pub mod obverse {
    use super::*;

    /// Placeholder so the workspace builds and the test harness has something to call.
    /// Replaced by `initialize_config` in Phase 1.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx)
    }
}
