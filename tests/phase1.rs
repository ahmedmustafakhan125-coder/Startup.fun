//! Phase 1 tests: config, demo USDC, listing and the raise. Run with `anchor test`
//! (which builds the .so first). Everything runs in-process on LiteSVM.

mod common;
use common::*;

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
