//! Shared LiteSVM helpers for the program tests.
#![allow(dead_code, unused_imports)]

pub use {
    anchor_lang::{
        prelude::{pubkey, Clock, Pubkey},
        solana_program::instruction::{AccountMeta, Instruction},
        system_program, AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData,
        ToAccountMetas,
    },
    anchor_spl::token::ID as TOKEN_PROGRAM,
    base64::Engine,
    litesvm::LiteSVM,
    obverse::{
        constants::*,
        events::*,
        state::{Config, Heartbeat, Phase, Startup},
        CreateStartupArgs, InitializeConfigArgs, UpdateConfigArgs,
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub const ATA_PROGRAM: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const COMPUTE_BUDGET: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");
pub const USDC: u64 = UNIT;
pub const TOKENS: u64 = UNIT;

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &obverse::id()).0
}

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), TOKEN_PROGRAM.as_ref(), mint.as_ref()],
        &ATA_PROGRAM,
    )
    .0
}

pub fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction::new_with_bytes(obverse::id(), &data.data(), accounts.to_account_metas(None))
}

/// Every PDA that belongs to one startup.
pub struct Listing {
    pub startup: Pubkey,
    pub vault_authority: Pubkey,
    pub mint: Pubkey,
    pub sale_vault: Pubkey,
    pub pool_token: Pubkey,
    pub founder_lock: Pubkey,
    pub platform_lock: Pubkey,
    pub raise_vault: Pubkey,
    pub treasury_vault: Pubkey,
    pub fee_vault: Pubkey,
    pub reserve_vault: Pubkey,
    pub pool_usdc: Pubkey,
    pub refund_vault: Pubkey,
}

impl Listing {
    pub fn of(ticker: &str) -> Self {
        let startup = pda(&[STARTUP_SEED, ticker.as_bytes()]);
        let at = |seed: &[u8]| pda(&[seed, startup.as_ref()]);
        Self {
            startup,
            vault_authority: at(VAULT_SEED),
            mint: at(MINT_SEED),
            sale_vault: at(SALE_VAULT_SEED),
            pool_token: at(POOL_TOKEN_SEED),
            founder_lock: at(FOUNDER_LOCK_SEED),
            platform_lock: at(PLATFORM_LOCK_SEED),
            raise_vault: at(RAISE_VAULT_SEED),
            treasury_vault: at(TREASURY_VAULT_SEED),
            fee_vault: at(FEE_VAULT_SEED),
            reserve_vault: at(RESERVE_VAULT_SEED),
            pool_usdc: at(POOL_USDC_SEED),
            refund_vault: at(REFUND_VAULT_SEED),
        }
    }
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub operator: Keypair,
    pub platform: Keypair,
    pub founder: Keypair,
    pub monthly_budget: u64,
    pub fee_cap: u64,
    pub config: Pubkey,
    pub usdc_mint: Pubkey,
}

impl Env {
    /// Program loaded and config initialised with devnet timing.
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/obverse.so"
        ));
        svm.add_program(obverse::id(), bytes).unwrap();
        // LiteSVM starts at unix time 0; use a real-looking time so timestamps are meaningful.
        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = 1_800_000_000;
        svm.set_sysvar(&clock);
        let mut env = Self {
            svm,
            admin: Keypair::new(),
            operator: Keypair::new(),
            platform: Keypair::new(),
            founder: Keypair::new(),
            monthly_budget: 5_000 * USDC,
            fee_cap: 1_000 * USDC,
            config: pda(&[CONFIG_SEED]),
            usdc_mint: pda(&[USDC_SEED]),
        };
        for key in [
            env.admin.pubkey(),
            env.operator.pubkey(),
            env.platform.pubkey(),
            env.founder.pubkey(),
        ] {
            env.svm.airdrop(&key, 100_000_000_000).unwrap();
        }
        let init = env.init_config_ix(&env.admin.pubkey());
        let admin = env.admin.insecure_clone();
        env.send(&[init], &[&admin]).unwrap();
        let platform = env.platform.insecure_clone();
        env.create_ata(&platform, &env.usdc_mint.clone());
        env
    }

    pub fn init_config_ix(&self, deployer: &Pubkey) -> Instruction {
        ix(
            obverse::accounts::InitializeConfig {
                deployer: *deployer,
                config: self.config,
                usdc_mint: self.usdc_mint,
                infra_vault: pda(&[INFRA_SEED]),
                token_program: TOKEN_PROGRAM,
                system_program: system_program::ID,
            },
            obverse::instruction::InitializeConfig {
                args: InitializeConfigArgs {
                    operator: self.operator.pubkey(),
                    platform_wallet: self.platform.pubkey(),
                    month_seconds: 300,
                    winddown_seconds: 600,
                },
            },
        )
    }

    /// Sends one transaction. Ok and Err both carry the program logs.
    pub fn send(
        &mut self,
        ixs: &[Instruction],
        signers: &[&Keypair],
    ) -> Result<Vec<String>, Vec<String>> {
        self.svm.expire_blockhash(); // lets a test repeat an identical transaction
        let msg = Message::new_with_blockhash(
            ixs,
            Some(&signers[0].pubkey()),
            &self.svm.latest_blockhash(),
        );
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        match self.svm.send_transaction(tx) {
            Ok(meta) => Ok(meta.logs),
            Err(failed) => Err(failed.meta.logs),
        }
    }

    pub fn create_ata(&mut self, owner: &Keypair, mint: &Pubkey) -> Pubkey {
        let address = ata(&owner.pubkey(), mint);
        let create = Instruction::new_with_bytes(
            ATA_PROGRAM,
            &[1], // CreateIdempotent
            vec![
                AccountMeta::new(owner.pubkey(), true),
                AccountMeta::new(address, false),
                AccountMeta::new_readonly(owner.pubkey(), false),
                AccountMeta::new_readonly(*mint, false),
                AccountMeta::new_readonly(system_program::ID, false),
                AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            ],
        );
        self.send(&[create], &[owner]).unwrap();
        address
    }

    pub fn faucet_ix(&self, user: &Pubkey, amount: u64) -> Instruction {
        ix(
            obverse::accounts::Faucet {
                user: *user,
                config: self.config,
                usdc_mint: self.usdc_mint,
                user_usdc: ata(user, &self.usdc_mint),
                token_program: TOKEN_PROGRAM,
            },
            obverse::instruction::Faucet { amount },
        )
    }

    /// A new wallet holding `usdc` demo USDC (base units), filled through the faucet.
    pub fn user(&mut self, usdc: u64) -> Keypair {
        let user = Keypair::new();
        self.svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
        let mint = self.usdc_mint;
        self.create_ata(&user, &mint);
        let mut left = usdc;
        while left > 0 {
            let amount = left.min(FAUCET_MAX);
            let faucet = self.faucet_ix(&user.pubkey(), amount);
            self.send(&[faucet], &[&user]).unwrap();
            left -= amount;
        }
        user
    }

    pub fn create_startup_ixs(
        &self,
        operator: &Pubkey,
        ticker: &str,
        raise_target: u64,
    ) -> Vec<Instruction> {
        let l = Listing::of(ticker);
        vec![
            Instruction::new_with_bytes(COMPUTE_BUDGET, &[2, 0x80, 0x1a, 0x06, 0], vec![]), // 400,000 units
            ix(
                obverse::accounts::CreateStartup {
                    operator: *operator,
                    config: self.config,
                    startup: l.startup,
                    vault_authority: l.vault_authority,
                    mint: l.mint,
                    sale_vault: l.sale_vault,
                    pool_token: l.pool_token,
                    founder_lock: l.founder_lock,
                    platform_lock: l.platform_lock,
                    token_program: TOKEN_PROGRAM,
                    system_program: system_program::ID,
                },
                obverse::instruction::CreateStartup {
                    args: CreateStartupArgs {
                        ticker: ticker.to_string(),
                        founder: self.founder.pubkey(),
                        raise_target,
                        monthly_budget: self.monthly_budget,
                        fee_cap: self.fee_cap,
                    },
                },
            ),
            ix(
                obverse::accounts::CreateStartupVaults {
                    operator: *operator,
                    config: self.config,
                    usdc_mint: self.usdc_mint,
                    startup: l.startup,
                    vault_authority: l.vault_authority,
                    raise_vault: l.raise_vault,
                    treasury_vault: l.treasury_vault,
                    fee_vault: l.fee_vault,
                    reserve_vault: l.reserve_vault,
                    pool_usdc: l.pool_usdc,
                    refund_vault: l.refund_vault,
                    token_program: TOKEN_PROGRAM,
                    system_program: system_program::ID,
                },
                obverse::instruction::CreateStartupVaults {},
            ),
        ]
    }

    pub fn list(&mut self, ticker: &str, raise_target: u64) -> Listing {
        let ixs = self.create_startup_ixs(&self.operator.pubkey(), ticker, raise_target);
        let operator = self.operator.insecure_clone();
        self.send(&ixs, &[&operator]).unwrap();
        Listing::of(ticker)
    }

    pub fn commit(
        &mut self,
        l: &Listing,
        buyer: &Keypair,
        usdc_in: u64,
    ) -> Result<Vec<String>, Vec<String>> {
        self.create_ata(buyer, &l.mint);
        let commit = ix(
            obverse::accounts::Commit {
                buyer: buyer.pubkey(),
                config: self.config,
                startup: l.startup,
                vault_authority: l.vault_authority,
                usdc_mint: self.usdc_mint,
                mint: l.mint,
                buyer_usdc: ata(&buyer.pubkey(), &self.usdc_mint),
                buyer_token: ata(&buyer.pubkey(), &l.mint),
                raise_vault: l.raise_vault,
                sale_vault: l.sale_vault,
                pool_token: l.pool_token,
                pool_usdc: l.pool_usdc,
                treasury_vault: l.treasury_vault,
                platform_usdc: ata(&self.platform.pubkey(), &self.usdc_mint),
                token_program: TOKEN_PROGRAM,
            },
            obverse::instruction::Commit { usdc_in },
        );
        self.send(&[commit], &[buyer])
    }

    pub fn close_raise(
        &mut self,
        l: &Listing,
        operator: &Keypair,
    ) -> Result<Vec<String>, Vec<String>> {
        let close = ix(
            obverse::accounts::CloseRaise {
                operator: operator.pubkey(),
                config: self.config,
                startup: l.startup,
                vault_authority: l.vault_authority,
                usdc_mint: self.usdc_mint,
                mint: l.mint,
                raise_vault: l.raise_vault,
                sale_vault: l.sale_vault,
                pool_token: l.pool_token,
                pool_usdc: l.pool_usdc,
                treasury_vault: l.treasury_vault,
                platform_usdc: ata(&self.platform.pubkey(), &self.usdc_mint),
                token_program: TOKEN_PROGRAM,
            },
            obverse::instruction::CloseRaise {},
        );
        self.send(&[close], &[operator])
    }

    pub fn update_config(
        &mut self,
        admin: &Keypair,
        args: UpdateConfigArgs,
    ) -> Result<Vec<String>, Vec<String>> {
        let update = ix(
            obverse::accounts::UpdateConfig {
                admin: admin.pubkey(),
                config: self.config,
            },
            obverse::instruction::UpdateConfig { args },
        );
        self.send(&[update], &[admin])
    }

    /// Sends one program instruction signed by `signer`.
    pub fn call(
        &mut self,
        accounts: impl ToAccountMetas,
        data: impl InstructionData,
        signer: &Keypair,
    ) -> Result<Vec<String>, Vec<String>> {
        self.send(&[ix(accounts, data)], &[signer])
    }

    /// Moves the chain clock forward.
    pub fn warp(&mut self, seconds: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += seconds;
        self.svm.set_sysvar(&clock);
    }

    /// A startup whose 100,000 USDC raise was filled by one buyer, so it is Live.
    pub fn live(&mut self, ticker: &str) -> (Listing, Keypair) {
        let l = self.list(ticker, 100_000 * USDC);
        let buyer = self.user(100_000 * USDC);
        self.commit(&l, &buyer, 100_000 * USDC).unwrap();
        (l, buyer)
    }

    fn trade_accounts(&self, l: &Listing, trader: &Pubkey) -> obverse::accounts::Trade {
        obverse::accounts::Trade {
            trader: *trader,
            config: self.config,
            startup: l.startup,
            vault_authority: l.vault_authority,
            usdc_mint: self.usdc_mint,
            mint: l.mint,
            trader_usdc: ata(trader, &self.usdc_mint),
            trader_token: ata(trader, &l.mint),
            pool_usdc: l.pool_usdc,
            pool_token: l.pool_token,
            fee_vault: l.fee_vault,
            reserve_vault: l.reserve_vault,
            platform_usdc: ata(&self.platform.pubkey(), &self.usdc_mint),
            infra_vault: pda(&[INFRA_SEED]),
            token_program: TOKEN_PROGRAM,
        }
    }

    pub fn buy(
        &mut self,
        l: &Listing,
        trader: &Keypair,
        usdc_in: u64,
        min_out: u64,
    ) -> Result<Vec<String>, Vec<String>> {
        self.create_ata(trader, &l.mint);
        let accounts = self.trade_accounts(l, &trader.pubkey());
        self.call(
            accounts,
            obverse::instruction::Buy {
                usdc_in,
                min_tokens_out: min_out,
            },
            trader,
        )
    }

    pub fn sell(
        &mut self,
        l: &Listing,
        trader: &Keypair,
        tokens_in: u64,
        min_out: u64,
    ) -> Result<Vec<String>, Vec<String>> {
        self.create_ata(trader, &l.mint);
        let accounts = self.trade_accounts(l, &trader.pubkey());
        self.call(
            accounts,
            obverse::instruction::Sell {
                tokens_in,
                min_usdc_out: min_out,
            },
            trader,
        )
    }

    pub fn heartbeat(
        &mut self,
        l: &Listing,
        status: Heartbeat,
    ) -> Result<Vec<String>, Vec<String>> {
        let operator = self.operator.insecure_clone();
        self.call(
            obverse::accounts::ReportHeartbeat {
                operator: operator.pubkey(),
                config: self.config,
                startup: l.startup,
            },
            obverse::instruction::ReportHeartbeat { status },
            &operator,
        )
    }

    pub fn pause(&mut self, paused: bool) {
        let admin = self.admin.insecure_clone();
        self.update_config(
            &admin,
            UpdateConfigArgs {
                paused: Some(paused),
                ..no_changes()
            },
        )
        .unwrap();
    }

    /// Balance of a token account, in base units.
    pub fn balance(&self, token_account: &Pubkey) -> u64 {
        let data = self
            .svm
            .get_account(token_account)
            .expect("token account exists")
            .data;
        u64::from_le_bytes(data[64..72].try_into().unwrap())
    }

    pub fn supply(&self, mint: &Pubkey) -> u64 {
        let data = self.svm.get_account(mint).expect("mint exists").data;
        u64::from_le_bytes(data[36..44].try_into().unwrap())
    }

    pub fn config(&self) -> Config {
        Config::try_deserialize(&mut &self.svm.get_account(&self.config).unwrap().data[..]).unwrap()
    }

    pub fn startup(&self, l: &Listing) -> Startup {
        Startup::try_deserialize(&mut &self.svm.get_account(&l.startup).unwrap().data[..]).unwrap()
    }
}

pub fn no_changes() -> UpdateConfigArgs {
    UpdateConfigArgs {
        admin: None,
        operator: None,
        platform_wallet: None,
        month_seconds: None,
        winddown_seconds: None,
        verification_fee: None,
        paused: None,
        faucet_enabled: None,
    }
}

/// The transaction must fail with this named program error.
#[track_caller]
pub fn assert_rejected(result: Result<Vec<String>, Vec<String>>, error: &str) {
    let logs = result.expect_err("transaction should have been rejected");
    let wanted = format!("Error Code: {error}.");
    assert!(
        logs.iter().any(|l| l.contains(&wanted)),
        "expected {error}, logs: {logs:#?}"
    );
}

pub fn has_event(logs: &[String]) -> bool {
    logs.iter().any(|l| l.starts_with("Program data: "))
}

/// Every event of type `T` in a transaction's logs.
pub fn events<T: AnchorDeserialize + Discriminator>(logs: &[String]) -> Vec<T> {
    logs.iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .filter_map(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
        .filter(|bytes| bytes.starts_with(T::DISCRIMINATOR))
        .map(|bytes| T::deserialize(&mut &bytes[T::DISCRIMINATOR.len()..]).unwrap())
        .collect()
}
