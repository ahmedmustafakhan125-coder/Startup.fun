use anchor_lang::prelude::*;

/// Named, specific errors only (CLAUDE.md conventions). Real variants arrive with Phase 1.
#[error_code]
pub enum ObverseError {
    #[msg("This action is not available yet")]
    NotImplemented,
}
