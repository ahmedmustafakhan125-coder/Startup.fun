use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, TransferChecked};

use crate::{constants::*, state::Startup};

/// Signs token CPIs as a startup's vault authority PDA.
pub struct Vault<'info> {
    startup: Pubkey,
    bump: u8,
    authority: AccountInfo<'info>,
    token_program: Pubkey,
}

impl<'info> Vault<'info> {
    pub fn new(
        startup: &Account<'info, Startup>,
        authority: &AccountInfo<'info>,
        token_program: Pubkey,
    ) -> Self {
        Self {
            startup: startup.key(),
            bump: startup.vault_bump,
            authority: authority.clone(),
            token_program,
        }
    }

    pub fn transfer(
        &self,
        from: &AccountInfo<'info>,
        mint: &AccountInfo<'info>,
        to: &AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        token::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program,
                TransferChecked {
                    from: from.clone(),
                    mint: mint.clone(),
                    to: to.clone(),
                    authority: self.authority.clone(),
                },
                &[&[VAULT_SEED, self.startup.as_ref(), &[self.bump]]],
            ),
            amount,
            DECIMALS,
        )
    }

    pub fn burn(
        &self,
        from: &AccountInfo<'info>,
        mint: &AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        token::burn(
            CpiContext::new_with_signer(
                self.token_program,
                Burn {
                    mint: mint.clone(),
                    from: from.clone(),
                    authority: self.authority.clone(),
                },
                &[&[VAULT_SEED, self.startup.as_ref(), &[self.bump]]],
            ),
            amount,
        )
    }
}

/// Transfer signed by the wallet that owns `from`.
pub fn transfer_from_user<'info>(
    token_program: Pubkey,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    token::transfer_checked(
        CpiContext::new(
            token_program,
            TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: authority.clone(),
            },
        ),
        amount,
        DECIMALS,
    )
}
