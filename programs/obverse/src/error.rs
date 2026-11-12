use anchor_lang::prelude::*;

/// Named, specific errors only (CLAUDE.md conventions).
#[error_code]
pub enum ObverseError {
    #[msg("Only the admin can do this")]
    NotAdmin,
    #[msg("Only the operator can do this")]
    NotOperator,
    #[msg("The program is paused")]
    Paused,
    #[msg("Time settings must be greater than zero")]
    InvalidConfig,
    #[msg("The faucet is switched off")]
    FaucetDisabled,
    #[msg("The faucet gives at most 5,000 demo USDC per call")]
    FaucetCapExceeded,
    #[msg("The application id is too long")]
    ApplicationIdTooLong,
    #[msg("The ticker needs 3 to 5 capital letters")]
    InvalidTicker,
    #[msg("The amount must be greater than zero")]
    InvalidAmount,
    #[msg("The raise is closed")]
    RaiseClosed,
    #[msg("The amount is too small to buy any tokens")]
    CommitTooSmall,
    #[msg("Nothing has been committed to this raise yet")]
    NothingCommitted,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
