//! Phase 3 tests: heartbeat, capped payouts, vesting, wind-down and refunds.
//! Devnet timing: one "month" is 300 seconds and the wind-down wait is 600 seconds.

mod common;
use common::*;

const MONTH: i64 = 300;
type TxResult = Result<Vec<String>, Vec<String>>;

fn founder_claim_accounts(
    env: &mut Env,
    l: &Listing,
    signer: &Keypair,
) -> obverse::accounts::FounderClaim {
    let usdc_mint = env.usdc_mint;
    obverse::accounts::FounderClaim {
        founder: signer.pubkey(),
        config: env.config,
        startup: l.startup,
        vault_authority: l.vault_authority,
        usdc_mint,
        treasury_vault: l.treasury_vault,
        fee_vault: l.fee_vault,
        founder_usdc: env.create_ata(signer, &usdc_mint),
        token_program: TOKEN_PROGRAM,
    }
}

fn claim_treasury(env: &mut Env, l: &Listing, signer: &Keypair) -> TxResult {
    let accounts = founder_claim_accounts(env, l, signer);
    env.call(accounts, obverse::instruction::ClaimTreasury {}, signer)
}

fn claim_fees(env: &mut Env, l: &Listing, signer: &Keypair) -> TxResult {
    let accounts = founder_claim_accounts(env, l, signer);
    env.call(accounts, obverse::instruction::ClaimFees {}, signer)
}

fn claim_founder_tokens(env: &mut Env, l: &Listing, signer: &Keypair) -> TxResult {
    let accounts = obverse::accounts::ClaimFounderTokens {
        founder: signer.pubkey(),
        config: env.config,
        startup: l.startup,
        vault_authority: l.vault_authority,
        mint: l.mint,
        founder_lock: l.founder_lock,
        founder_token: env.create_ata(signer, &l.mint),
        token_program: TOKEN_PROGRAM,
    };
    env.call(
        accounts,
        obverse::instruction::ClaimFounderTokens {},
        signer,
    )
}

fn claim_platform_tokens(env: &mut Env, l: &Listing, signer: &Keypair) -> TxResult {
    let platform = env.platform.insecure_clone();
    let accounts = obverse::accounts::ClaimPlatformTokens {
        admin: signer.pubkey(),
        config: env.config,
        startup: l.startup,
        vault_authority: l.vault_authority,
        mint: l.mint,
        platform_lock: l.platform_lock,
        platform_token: env.create_ata(&platform, &l.mint),
        token_program: TOKEN_PROGRAM,
    };
    env.call(
        accounts,
        obverse::instruction::ClaimPlatformTokens {},
        signer,
    )
}

fn wind_down(env: &mut Env, l: &Listing, caller: &Keypair) -> TxResult {
    let accounts = obverse::accounts::WindDown {
        caller: caller.pubkey(),
        config: env.config,
        startup: l.startup,
        vault_authority: l.vault_authority,
        usdc_mint: env.usdc_mint,
        mint: l.mint,
        treasury_vault: l.treasury_vault,
        fee_vault: l.fee_vault,
        reserve_vault: l.reserve_vault,
        pool_usdc: l.pool_usdc,
        refund_vault: l.refund_vault,
        founder_lock: l.founder_lock,
        platform_lock: l.platform_lock,
        pool_token: l.pool_token,
        token_program: TOKEN_PROGRAM,
    };
    env.call(accounts, obverse::instruction::WindDown {}, caller)
}

fn claim_refund(env: &mut Env, l: &Listing, holder: &Keypair, amount: u64) -> TxResult {
    let accounts = obverse::accounts::ClaimRefund {
        holder: holder.pubkey(),
        config: env.config,
        startup: l.startup,
        vault_authority: l.vault_authority,
        usdc_mint: env.usdc_mint,
        mint: l.mint,
        holder_token: ata(&holder.pubkey(), &l.mint),
        holder_usdc: ata(&holder.pubkey(), &env.usdc_mint),
        refund_vault: l.refund_vault,
        token_program: TOKEN_PROGRAM,
    };
    env.call(
        accounts,
        obverse::instruction::ClaimRefund { amount },
        holder,
    )
}

#[test]
fn heartbeat_keeps_red_time_books() {
    let mut env = Env::new();
    let raising = env.list("RAISE", 100_000 * USDC);
    assert_rejected(env.heartbeat(&raising, Heartbeat::Red), "NotLive");

    let (l, _) = env.live("ACME");
    let live_at = env.startup(&l).live_at;
    let stranger = env.user(0);
    assert_rejected(
        env.call(
            obverse::accounts::ReportHeartbeat {
                operator: stranger.pubkey(),
                config: env.config,
                startup: l.startup,
            },
            obverse::instruction::ReportHeartbeat {
                status: Heartbeat::Red,
            },
            &stranger,
        ),
        "NotOperator",
    );

    env.warp(10);
    let logs = env.heartbeat(&l, Heartbeat::Red).unwrap();
    assert!(!events::<HeartbeatReported>(&logs)[0].green);
    let s = env.startup(&l);
    assert!(s.heartbeat == Heartbeat::Red);
    assert_eq!(
        (s.red_since, s.red_seconds_total, s.last_beat),
        (live_at + 10, 0, live_at)
    );

    // A repeated Red keeps the original start of the silence.
    env.warp(100);
    env.heartbeat(&l, Heartbeat::Red).unwrap();
    assert_eq!(env.startup(&l).red_since, live_at + 10);

    env.warp(50);
    env.heartbeat(&l, Heartbeat::Green).unwrap();
    let s = env.startup(&l);
    assert!(s.heartbeat == Heartbeat::Green);
    assert_eq!(
        (s.red_since, s.red_seconds_total, s.last_beat),
        (0, 150, live_at + 160)
    );

    // A second silence adds to the total; a Green report refreshes last_beat.
    env.heartbeat(&l, Heartbeat::Red).unwrap();
    env.warp(40);
    env.heartbeat(&l, Heartbeat::Green).unwrap();
    env.warp(5);
    env.heartbeat(&l, Heartbeat::Green).unwrap();
    let s = env.startup(&l);
    assert_eq!((s.red_seconds_total, s.last_beat), (190, live_at + 205));
}

#[test]
fn treasury_claims_follow_the_monthly_budget() {
    let mut env = Env::new();
    let (l, _) = env.live("ACME");
    let founder = env.founder.insecure_clone();
    let founder_usdc = ata(&founder.pubkey(), &env.usdc_mint);
    let stranger = env.user(0);
    assert_rejected(claim_treasury(&mut env, &l, &stranger), "NotFounder");

    let logs = claim_treasury(&mut env, &l, &founder).unwrap();
    let event = &events::<TreasuryClaimed>(&logs)[0];
    assert_eq!((event.amount, event.period), (5_000 * USDC, 0));
    assert_eq!(env.balance(&founder_usdc), 5_000 * USDC);
    assert_eq!(env.balance(&l.treasury_vault), 73_000 * USDC);
    assert_rejected(claim_treasury(&mut env, &l, &founder), "NothingToClaim");

    // Next period the budget is back. Two skipped periods do not add up.
    env.warp(3 * MONTH);
    claim_treasury(&mut env, &l, &founder).unwrap();
    assert_eq!(env.balance(&founder_usdc), 10_000 * USDC);
    assert_rejected(claim_treasury(&mut env, &l, &founder), "NothingToClaim");

    env.warp(MONTH);
    env.heartbeat(&l, Heartbeat::Red).unwrap();
    assert_rejected(claim_treasury(&mut env, &l, &founder), "HeartbeatRed");
    env.heartbeat(&l, Heartbeat::Green).unwrap();
    env.pause(true);
    assert_rejected(claim_treasury(&mut env, &l, &founder), "Paused");
    env.pause(false);
    claim_treasury(&mut env, &l, &founder).unwrap();
    assert_eq!(env.balance(&founder_usdc), 15_000 * USDC);
}

#[test]
fn treasury_claim_is_limited_by_what_the_vault_holds() {
    let mut env = Env::new();
    env.monthly_budget = 50_000 * USDC;
    let (l, _) = env.live("ACME");
    let founder = env.founder.insecure_clone();
    claim_treasury(&mut env, &l, &founder).unwrap();
    env.warp(MONTH);
    claim_treasury(&mut env, &l, &founder).unwrap(); // only 28,000 left of the 78,000
    assert_eq!(
        env.balance(&ata(&founder.pubkey(), &env.usdc_mint)),
        78_000 * USDC
    );
    assert_eq!(env.balance(&l.treasury_vault), 0);
    env.warp(MONTH);
    assert_rejected(claim_treasury(&mut env, &l, &founder), "NothingToClaim");
}

#[test]
fn fee_claims_stop_at_the_cap() {
    let mut env = Env::new();
    env.fee_cap = 2 * USDC;
    let (l, _) = env.live("ACME");
    let founder = env.founder.insecure_clone();
    let founder_usdc = ata(&founder.pubkey(), &env.usdc_mint);
    assert_rejected(claim_fees(&mut env, &l, &founder), "NothingToClaim"); // empty vault

    let trader = env.user(5_000 * USDC);
    env.buy(&l, &trader, 5_000 * USDC, 0).unwrap();
    assert_eq!(env.balance(&l.fee_vault), 15 * USDC);

    let stranger = env.user(0);
    assert_rejected(claim_fees(&mut env, &l, &stranger), "NotFounder");
    let logs = claim_fees(&mut env, &l, &founder).unwrap();
    assert_eq!(events::<FeesClaimed>(&logs)[0].amount, 2 * USDC);
    assert_rejected(claim_fees(&mut env, &l, &founder), "NothingToClaim");
    assert_eq!(env.balance(&founder_usdc), 2 * USDC);

    env.heartbeat(&l, Heartbeat::Red).unwrap();
    env.warp(MONTH);
    assert_rejected(claim_fees(&mut env, &l, &founder), "HeartbeatRed");
    env.heartbeat(&l, Heartbeat::Green).unwrap();
    claim_fees(&mut env, &l, &founder).unwrap();
    assert_eq!(env.balance(&founder_usdc), 4 * USDC);
    assert_eq!(env.balance(&l.fee_vault), 11 * USDC);
    // The treasury budget is tracked separately from the fee cap.
    claim_treasury(&mut env, &l, &founder).unwrap();
}

#[test]
fn locked_tokens_vest_monthly_after_the_lock_and_only_in_green_time() {
    let mut env = Env::new();
    let (l, _) = env.live("ACME");
    let (founder, admin) = (env.founder.insecure_clone(), env.admin.insecure_clone());
    let founder_token = ata(&founder.pubkey(), &l.mint);
    let step = FOUNDER_SUPPLY / 24;

    // Nothing during the 12 month lock, including its last second.
    assert_rejected(
        claim_founder_tokens(&mut env, &l, &founder),
        "NothingToClaim",
    );
    env.warp(13 * MONTH - 1);
    assert_rejected(
        claim_founder_tokens(&mut env, &l, &founder),
        "NothingToClaim",
    );
    assert_rejected(
        claim_platform_tokens(&mut env, &l, &admin),
        "NothingToClaim",
    );

    // Month 13: one of 24 steps.
    env.warp(1);
    let stranger = env.user(0);
    assert_rejected(claim_founder_tokens(&mut env, &l, &stranger), "NotFounder");
    assert_rejected(claim_platform_tokens(&mut env, &l, &stranger), "NotAdmin");
    let logs = claim_founder_tokens(&mut env, &l, &founder).unwrap();
    assert_eq!(events::<TokensClaimed>(&logs)[0].amount, step);
    assert_eq!(env.balance(&founder_token), step);
    assert_rejected(
        claim_founder_tokens(&mut env, &l, &founder),
        "NothingToClaim",
    );
    claim_platform_tokens(&mut env, &l, &admin).unwrap();
    assert_eq!(
        env.balance(&ata(&env.platform.pubkey(), &l.mint)),
        PLATFORM_SUPPLY / 24
    );

    // Two red months: no claims, and the clock for vesting stands still.
    env.heartbeat(&l, Heartbeat::Red).unwrap();
    env.warp(2 * MONTH);
    assert_rejected(claim_founder_tokens(&mut env, &l, &founder), "HeartbeatRed");
    assert_rejected(claim_platform_tokens(&mut env, &l, &admin), "HeartbeatRed");
    env.heartbeat(&l, Heartbeat::Green).unwrap();
    assert_rejected(
        claim_founder_tokens(&mut env, &l, &founder),
        "NothingToClaim",
    );

    // One more green month: the second step.
    env.warp(MONTH);
    claim_founder_tokens(&mut env, &l, &founder).unwrap();
    assert_eq!(env.balance(&founder_token), FOUNDER_SUPPLY * 2 / 24);

    // Long after the schedule ends everything is released, and no more.
    env.warp(40 * MONTH);
    claim_founder_tokens(&mut env, &l, &founder).unwrap();
    claim_platform_tokens(&mut env, &l, &admin).unwrap();
    assert_eq!(env.balance(&founder_token), FOUNDER_SUPPLY);
    assert_eq!(env.balance(&l.founder_lock), 0);
    assert_eq!(env.balance(&l.platform_lock), 0);
    assert_eq!(env.startup(&l).founder_claimed, FOUNDER_SUPPLY);
    assert_rejected(
        claim_founder_tokens(&mut env, &l, &founder),
        "NothingToClaim",
    );
}

#[test]
fn lifecycle_from_raise_to_wind_down_and_refunds() {
    let mut env = Env::new();
    let l = env.list("ACME", 100_000 * USDC);
    let (alice, bob) = (env.user(40_000 * USDC), env.user(60_000 * USDC));
    env.commit(&l, &alice, 40_000 * USDC).unwrap();
    env.commit(&l, &bob, 60_000 * USDC).unwrap();
    assert_rejected(claim_refund(&mut env, &l, &alice, TOKENS), "NotWoundDown");

    // Some life: a trade (carol becomes a third holder) and one treasury claim.
    let carol = env.user(2_000 * USDC);
    env.buy(&l, &carol, 2_000 * USDC, 0).unwrap();
    let founder = env.founder.insecure_clone();
    claim_treasury(&mut env, &l, &founder).unwrap();

    // Wind-down needs Red for the full wait.
    let stranger = env.user(0);
    assert_rejected(wind_down(&mut env, &l, &stranger), "HeartbeatGreen");
    env.heartbeat(&l, Heartbeat::Red).unwrap();
    env.warp(2 * MONTH - 1);
    assert_rejected(wind_down(&mut env, &l, &stranger), "WinddownTooEarly");
    env.sell(&l, &carol, 1_000 * TOKENS, 0).unwrap(); // trading stays open while red
    env.warp(1);

    let expected_pool = env.balance(&l.treasury_vault)
        + env.balance(&l.fee_vault)
        + env.balance(&l.reserve_vault)
        + env.balance(&l.pool_usdc);
    let holders = [&alice, &bob, &carol].map(|h| env.balance(&ata(&h.pubkey(), &l.mint)));
    let logs = wind_down(&mut env, &l, &stranger).unwrap();
    let event = &events::<WoundDown>(&logs)[0];

    let s = env.startup(&l);
    assert!(s.phase == Phase::WoundDown);
    assert_eq!(
        (s.refund_pool, event.refund_pool),
        (expected_pool, expected_pool)
    );
    assert_eq!(env.balance(&l.refund_vault), expected_pool);
    for emptied in [l.treasury_vault, l.fee_vault, l.reserve_vault, l.pool_usdc] {
        assert_eq!(env.balance(&emptied), 0);
    }
    for burned in [l.founder_lock, l.platform_lock, l.pool_token] {
        assert_eq!(env.balance(&burned), 0);
    }
    let circulating: u64 = holders.iter().sum();
    assert_eq!(
        (s.refund_circulating, env.supply(&l.mint)),
        (circulating, circulating)
    );

    // Everything else is closed for good.
    assert_rejected(env.buy(&l, &carol, 100 * USDC, 0), "NotLive");
    assert_rejected(env.sell(&l, &carol, TOKENS, 0), "NotLive");
    assert_rejected(claim_treasury(&mut env, &l, &founder), "NotLive");
    assert_rejected(claim_fees(&mut env, &l, &founder), "NotLive");
    assert_rejected(claim_founder_tokens(&mut env, &l, &founder), "NotLive");
    assert_rejected(env.heartbeat(&l, Heartbeat::Green), "NotLive");
    assert_rejected(wind_down(&mut env, &l, &stranger), "NotLive");

    // Refunds are pro rata and work even while the program is paused.
    env.pause(true);
    let share = |amount: u64| (amount as u128 * expected_pool as u128 / circulating as u128) as u64;
    for (holder, held) in [&alice, &bob, &carol].into_iter().zip(holders) {
        let usdc = ata(&holder.pubkey(), &env.usdc_mint);
        let before = env.balance(&usdc);
        assert_rejected(
            claim_refund(&mut env, &l, holder, held + 1),
            "InsufficientBalance",
        );
        let logs = claim_refund(&mut env, &l, holder, held).unwrap();
        assert_eq!(events::<Refunded>(&logs)[0].usdc_paid, share(held));
        assert_eq!(env.balance(&usdc) - before, share(held));
        assert_eq!(env.balance(&ata(&holder.pubkey(), &l.mint)), 0);
    }
    assert!(share(holders[1]) > share(holders[0]) && share(holders[0]) > share(holders[2]));
    assert_eq!(env.supply(&l.mint), 0);
    assert!(
        env.balance(&l.refund_vault) < 3,
        "only rounding dust is left"
    );
}

#[test]
fn pause_blocks_every_claim() {
    let mut env = Env::new();
    let (l, _) = env.live("ACME");
    let (founder, admin) = (env.founder.insecure_clone(), env.admin.insecure_clone());
    env.warp(13 * MONTH);
    env.pause(true);
    assert_rejected(claim_treasury(&mut env, &l, &founder), "Paused");
    assert_rejected(claim_fees(&mut env, &l, &founder), "Paused");
    assert_rejected(claim_founder_tokens(&mut env, &l, &founder), "Paused");
    assert_rejected(claim_platform_tokens(&mut env, &l, &admin), "Paused");
}
