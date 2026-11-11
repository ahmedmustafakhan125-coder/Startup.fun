use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    pub payer: Signer<'info>,
}

pub fn handle_initialize(ctx: Context<Initialize>) -> Result<()> {
    msg!("Obverse scaffold ready, called by {}", ctx.accounts.payer.key());
    Ok(())
}
