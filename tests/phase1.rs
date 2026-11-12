//! Phase 1 tests: config, demo USDC, listing and the raise. Run with `anchor test`
//! (which builds the .so first). Everything runs in-process on LiteSVM.

use {
    anchor_lang::{
        prelude::{pubkey, Clock, Pubkey},
        solana_program::instruction::{AccountMeta, Instruction},
        system_program, AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::ID as TOKEN_PROGRAM,
    litesvm::LiteSVM,
    obverse::{
        constants::*,
        state::{Config, Phase, Startup},
        CreateStartupArgs, InitializeConfigArgs, UpdateConfigArgs,
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const ATA_PROGRAM: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const COMPUTE_BUDGET: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");
const USDC: u64 = UNIT;
const TOKENS: u64 = UNIT;

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &obverse::id()).0
}

fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), TOKEN_PROGRAM.as_ref(), mint.as_ref()],
        &ATA_PROGRAM,
    )
    .0
}

fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction::new_with_bytes(obverse::id(), &data.data(), accounts.to_account_metas(None))
}

/// Every PDA that belongs to one startup.
struct Listing {
    startup: Pubkey,
    vault_authority: Pubkey,
    mint: Pubkey,
    sale_vault: Pubkey,
    pool_token: Pubkey,
    founder_lock: Pubkey,
    platform_lock: Pubkey,
    raise_vault: Pubkey,
    treasury_vault: Pubkey,
    fee_vault: Pubkey,
    reserve_vault: Pubkey,
    pool_usdc: Pubkey,
    refund_vault: Pubkey,
}

impl Listing {
    fn of(ticker: &str) -> Self {
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

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    operator: Keypair,
    platform: Keypair,
    config: Pubkey,
    usdc_mint: Pubkey,
}

impl Env {
    /// Program loaded and config initialised with devnet timing.
    fn new() -> Self {
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
            config: pda(&[CONFIG_SEED]),
            usdc_mint: pda(&[USDC_SEED]),
        };
        for key in [
            env.admin.pubkey(),
            env.operator.pubkey(),
            env.platform.pubkey(),
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

    fn init_config_ix(&self, deployer: &Pubkey) -> Instruction {
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
    fn send(
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

    fn create_ata(&mut self, owner: &Keypair, mint: &Pubkey) -> Pubkey {
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

    fn faucet_ix(&self, user: &Pubkey, amount: u64) -> Instruction {
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
    fn user(&mut self, usdc: u64) -> Keypair {
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

    fn create_startup_ixs(
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
                        founder: Pubkey::new_unique(),
                        raise_target,
                        monthly_budget: 5_000 * USDC,
                        fee_cap: 1_000 * USDC,
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

    fn list(&mut self, ticker: &str, raise_target: u64) -> Listing {
        let ixs = self.create_startup_ixs(&self.operator.pubkey(), ticker, raise_target);
        let operator = self.operator.insecure_clone();
        self.send(&ixs, &[&operator]).unwrap();
        Listing::of(ticker)
    }

    fn commit(
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

    fn close_raise(&mut self, l: &Listing, operator: &Keypair) -> Result<Vec<String>, Vec<String>> {
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

    fn update_config(
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

    /// Balance of a token account, in base units.
    fn balance(&self, token_account: &Pubkey) -> u64 {
        let data = self
            .svm
            .get_account(token_account)
            .expect("token account exists")
            .data;
        u64::from_le_bytes(data[64..72].try_into().unwrap())
    }

    fn supply(&self, mint: &Pubkey) -> u64 {
        let data = self.svm.get_account(mint).expect("mint exists").data;
        u64::from_le_bytes(data[36..44].try_into().unwrap())
    }

    fn config(&self) -> Config {
        Config::try_deserialize(&mut &self.svm.get_account(&self.config).unwrap().data[..]).unwrap()
    }

    fn startup(&self, l: &Listing) -> Startup {
        Startup::try_deserialize(&mut &self.svm.get_account(&l.startup).unwrap().data[..]).unwrap()
    }
}

fn no_changes() -> UpdateConfigArgs {
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
fn assert_rejected(result: Result<Vec<String>, Vec<String>>, error: &str) {
    let logs = result.expect_err("transaction should have been rejected");
    let wanted = format!("Error Code: {error}.");
    assert!(
        logs.iter().any(|l| l.contains(&wanted)),
        "expected {error}, logs: {logs:#?}"
    );
}

fn has_event(logs: &[String]) -> bool {
    logs.iter().any(|l| l.starts_with("Program data: "))
}

#[test]
fn config_init_and_update_permissions() {
    let mut env = Env::new();
    let config = env.config();
    assert_eq!(config.admin, env.admin.pubkey());
    assert_eq!(config.operator, env.operator.pubkey());
    assert_eq!(config.usdc_mint, env.usdc_mint);
    assert_eq!(
        (
            config.trade_fee_bps,
            config.listing_fee_bps,
            config.treasury_share_bps
        ),
        (100, 250, 8_000)
    );
    assert_eq!(
        config.platform_fee_bps
            + config.startup_fee_bps
            + config.reserve_fee_bps
            + config.infra_fee_bps,
        config.trade_fee_bps
    );
    assert_eq!((config.month_seconds, config.winddown_seconds), (300, 600));
    assert_eq!((config.cliff_months, config.vest_months), (12, 24));
    assert_eq!(config.verification_fee, 300 * USDC);
    assert!(!config.paused && config.faucet_enabled);

    // A second initialisation cannot take over the config.
    let stranger = env.user(0);
    let again = env.init_config_ix(&stranger.pubkey());
    assert!(env.send(&[again], &[&stranger]).is_err());
    assert_eq!(env.config().admin, env.admin.pubkey());

    assert_rejected(
        env.update_config(
            &stranger,
            UpdateConfigArgs {
                paused: Some(true),
                ..no_changes()
            },
        ),
        "NotAdmin",
    );
    let admin = env.admin.insecure_clone();
    assert_rejected(
        env.update_config(
            &admin,
            UpdateConfigArgs {
                month_seconds: Some(0),
                ..no_changes()
            },
        ),
        "InvalidConfig",
    );
    let logs = env
        .update_config(
            &admin,
            UpdateConfigArgs {
                paused: Some(true),
                verification_fee: Some(1),
                ..no_changes()
            },
        )
        .unwrap();
    assert!(has_event(&logs));
    let config = env.config();
    assert!(config.paused);
    assert_eq!(config.verification_fee, 1);
    assert_eq!(
        config.operator,
        env.operator.pubkey(),
        "untouched fields keep their value"
    );
}

#[test]
fn faucet_cap_and_flag() {
    let mut env = Env::new();
    let user = env.user(0);
    let usdc = ata(&user.pubkey(), &env.usdc_mint);

    let at_cap = env.faucet_ix(&user.pubkey(), 5_000 * USDC);
    env.send(&[at_cap], &[&user]).unwrap();
    assert_eq!(env.balance(&usdc), 5_000 * USDC);

    let over_cap = env.faucet_ix(&user.pubkey(), 5_000 * USDC + 1);
    assert_rejected(env.send(&[over_cap], &[&user]), "FaucetCapExceeded");
    let zero = env.faucet_ix(&user.pubkey(), 0);
    assert_rejected(env.send(&[zero], &[&user]), "InvalidAmount");

    let admin = env.admin.insecure_clone();
    env.update_config(
        &admin,
        UpdateConfigArgs {
            faucet_enabled: Some(false),
            ..no_changes()
        },
    )
    .unwrap();
    let disabled = env.faucet_ix(&user.pubkey(), USDC);
    assert_rejected(env.send(&[disabled], &[&user]), "FaucetDisabled");
    assert_eq!(env.balance(&usdc), 5_000 * USDC);
}

#[test]
fn verification_fee_goes_to_the_platform() {
    let mut env = Env::new();
    let founder = env.user(1_000 * USDC);
    let platform_usdc = ata(&env.platform.pubkey(), &env.usdc_mint);
    let pay = |env: &Env, application_id: &str| {
        ix(
            obverse::accounts::PayVerificationFee {
                founder: founder.pubkey(),
                config: env.config,
                usdc_mint: env.usdc_mint,
                founder_usdc: ata(&founder.pubkey(), &env.usdc_mint),
                platform_usdc,
                token_program: TOKEN_PROGRAM,
            },
            obverse::instruction::PayVerificationFee {
                application_id: application_id.to_string(),
            },
        )
    };

    let logs = env.send(&[pay(&env, "app-123")], &[&founder]).unwrap();
    assert!(has_event(&logs));
    assert_eq!(env.balance(&platform_usdc), 300 * USDC);
    assert_eq!(
        env.balance(&ata(&founder.pubkey(), &env.usdc_mint)),
        700 * USDC
    );

    assert_rejected(
        env.send(&[pay(&env, &"x".repeat(65))], &[&founder]),
        "ApplicationIdTooLong",
    );
}

#[test]
fn listing_mints_the_fixed_supply_and_only_the_operator_can_list() {
    let mut env = Env::new();
    let stranger = env.user(0);
    let by_stranger = env.create_startup_ixs(&stranger.pubkey(), "ACME", 100_000 * USDC);
    assert_rejected(env.send(&by_stranger, &[&stranger]), "NotOperator");

    let operator = env.operator.insecure_clone();
    for bad_ticker in ["AB", "TOOLONG", "acme", "AC1E"] {
        let ixs = env.create_startup_ixs(&operator.pubkey(), bad_ticker, 100_000 * USDC);
        assert_rejected(env.send(&ixs, &[&operator]), "InvalidTicker");
    }
    let zero_target = env.create_startup_ixs(&operator.pubkey(), "ACME", 0);
    assert_rejected(env.send(&zero_target, &[&operator]), "InvalidAmount");

    let l = env.list("ACME", 100_000 * USDC);
    assert_eq!(env.balance(&l.sale_vault), 65_000_000 * TOKENS);
    assert_eq!(env.balance(&l.pool_token), 13_000_000 * TOKENS);
    assert_eq!(env.balance(&l.founder_lock), 20_000_000 * TOKENS);
    assert_eq!(env.balance(&l.platform_lock), 2_000_000 * TOKENS);
    assert_eq!(env.supply(&l.mint), 100_000_000 * TOKENS);
    let mint = env.svm.get_account(&l.mint).unwrap().data;
    assert_eq!(&mint[0..4], &[0; 4], "mint authority is removed");
    for vault in [
        l.raise_vault,
        l.treasury_vault,
        l.fee_vault,
        l.reserve_vault,
        l.pool_usdc,
        l.refund_vault,
    ] {
        assert_eq!(env.balance(&vault), 0);
    }
    let startup = env.startup(&l);
    assert!(startup.phase == Phase::Raising);
    assert_eq!(
        (
            startup.ticker.as_str(),
            startup.raise_target,
            startup.raised
        ),
        ("ACME", 100_000 * USDC, 0)
    );

    // The same ticker cannot be listed twice.
    let twice = env.create_startup_ixs(&operator.pubkey(), "ACME", 100_000 * USDC);
    assert!(env.send(&twice, &[&operator]).is_err());
}

#[test]
fn full_raise_closes_itself_with_the_documented_split() {
    let mut env = Env::new();
    let l = env.list("ACME", 100_000 * USDC);
    let platform_usdc = ata(&env.platform.pubkey(), &env.usdc_mint);
    let early = env.user(40_000 * USDC);
    let late = env.user(70_000 * USDC);

    // Before the target: fixed price, still raising.
    let logs = env.commit(&l, &early, 40_000 * USDC).unwrap();
    assert!(has_event(&logs));
    assert_eq!(
        env.balance(&ata(&early.pubkey(), &l.mint)),
        26_000_000 * TOKENS
    );
    assert_eq!(env.balance(&l.raise_vault), 40_000 * USDC);
    assert!(env.startup(&l).phase == Phase::Raising);

    // Beyond the target: clamped to the 60,000 of room that is left, then the raise closes.
    env.commit(&l, &late, 70_000 * USDC).unwrap();
    assert_eq!(
        env.balance(&ata(&late.pubkey(), &env.usdc_mint)),
        10_000 * USDC
    );
    assert_eq!(
        env.balance(&ata(&late.pubkey(), &l.mint)),
        39_000_000 * TOKENS
    );

    let startup = env.startup(&l);
    assert!(startup.phase == Phase::Live);
    assert_eq!(startup.raised, 100_000 * USDC);
    assert_eq!(startup.live_at, 1_800_000_000);
    assert_eq!(env.balance(&platform_usdc), 2_500 * USDC);
    assert_eq!(env.balance(&l.treasury_vault), 78_000 * USDC);
    assert_eq!(env.balance(&l.pool_usdc), 19_500 * USDC);
    assert_eq!(env.balance(&l.pool_token), 12_675_000 * TOKENS);
    assert_eq!(env.balance(&l.raise_vault), 0);
    assert_eq!(env.balance(&l.sale_vault), 0);
    // Burned: nothing unsold, 325,000 unused liquidity tokens.
    assert_eq!(env.supply(&l.mint), (100_000_000 - 325_000) * TOKENS);

    let after = env.user(100 * USDC);
    assert_rejected(env.commit(&l, &after, 100 * USDC), "RaiseClosed");
    let operator = env.operator.insecure_clone();
    assert_rejected(env.close_raise(&l, &operator), "RaiseClosed");
}

#[test]
fn commit_exactly_at_target_closes_the_raise() {
    let mut env = Env::new();
    let l = env.list("EXACT", 10_000 * USDC);
    let buyer = env.user(10_000 * USDC);
    env.commit(&l, &buyer, 10_000 * USDC).unwrap();
    assert!(env.startup(&l).phase == Phase::Live);
    assert_eq!(
        env.balance(&ata(&buyer.pubkey(), &l.mint)),
        65_000_000 * TOKENS
    );
    assert_eq!(env.balance(&l.pool_token), 12_675_000 * TOKENS);
}

#[test]
fn early_close_by_the_operator() {
    let mut env = Env::new();
    let l = env.list("ACME", 100_000 * USDC);
    let operator = env.operator.insecure_clone();
    assert_rejected(env.close_raise(&l, &operator), "NothingCommitted");

    let buyer = env.user(10_000 * USDC);
    env.commit(&l, &buyer, 10_000 * USDC).unwrap();
    assert_rejected(env.close_raise(&l, &buyer), "NotOperator");

    let logs = env.close_raise(&l, &operator).unwrap();
    assert!(has_event(&logs));
    assert!(env.startup(&l).phase == Phase::Live);
    assert_eq!(
        env.balance(&ata(&env.platform.pubkey(), &env.usdc_mint)),
        250 * USDC
    );
    assert_eq!(env.balance(&l.treasury_vault), 7_800 * USDC);
    assert_eq!(env.balance(&l.pool_usdc), 1_950 * USDC);
    assert_eq!(env.balance(&l.pool_token), 1_267_500 * TOKENS);
    assert_eq!(env.balance(&l.sale_vault), 0);
    // Left: 6.5M sold + 1,267,500 in the pool + 22M locked.
    assert_eq!(
        env.supply(&l.mint),
        (6_500_000 + 1_267_500 + 22_000_000) * TOKENS
    );

    assert_rejected(env.close_raise(&l, &operator), "RaiseClosed");
}

#[test]
fn commit_rejects_dust_and_respects_pause() {
    let mut env = Env::new();
    // At a 1 billion USDC target one base unit of USDC buys less than one base unit of token.
    let l = env.list("HUGE", 1_000_000_000 * USDC);
    let buyer = env.user(100 * USDC);
    assert_rejected(env.commit(&l, &buyer, 1), "CommitTooSmall");
    assert_rejected(env.commit(&l, &buyer, 0), "InvalidAmount");

    let admin = env.admin.insecure_clone();
    env.update_config(
        &admin,
        UpdateConfigArgs {
            paused: Some(true),
            ..no_changes()
        },
    )
    .unwrap();
    assert_rejected(env.commit(&l, &buyer, 100 * USDC), "Paused");
    env.update_config(
        &admin,
        UpdateConfigArgs {
            paused: Some(false),
            ..no_changes()
        },
    )
    .unwrap();
    env.commit(&l, &buyer, 100 * USDC).unwrap();
    assert_eq!(env.startup(&l).raised, 100 * USDC);
}
