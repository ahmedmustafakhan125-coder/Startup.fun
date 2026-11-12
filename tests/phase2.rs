//! Phase 2 tests: trading, the fee split, and parity with `app/src/lib/curve.ts`.

mod common;
use common::*;

/// `quoteBuy` from app/src/lib/curve.ts, ported line for line (display units, f64).
/// Returns (fee, tokensOut).
fn quote_buy(pool_usdc: f64, pool_tokens: f64, usdc_in: f64) -> (f64, f64) {
    let fee = usdc_in * 0.01;
    let net = usdc_in - fee;
    let k = pool_usdc * pool_tokens;
    (fee, pool_tokens - k / (pool_usdc + net))
}

/// `quoteSell` from app/src/lib/curve.ts. Returns (fee, usdcOut).
fn quote_sell(pool_usdc: f64, pool_tokens: f64, tokens_in: f64) -> (f64, f64) {
    let k = pool_usdc * pool_tokens;
    let gross = pool_usdc - k / (pool_tokens + tokens_in);
    let fee = gross * 0.01;
    (fee, gross - fee)
}

fn ui(base_units: u64) -> f64 {
    base_units as f64 / 1e6
}

/// f64 rounding noise allowed when comparing with the quote, in base units.
const NOISE: f64 = 0.05;

/// The program's result is within one base unit of the quote and never better for the trader.
#[track_caller]
fn assert_parity(actual: u64, quoted: f64, what: &str) {
    let short_by = quoted * 1e6 - actual as f64;
    assert!(
        short_by > -NOISE && short_by < 1.0 + NOISE,
        "{what}: program {actual}, quote {}",
        quoted * 1e6
    );
}

/// Balances a trade can touch.
fn snapshot(env: &Env, l: &Listing, trader: &Keypair) -> [u64; 8] {
    [
        env.balance(&ata(&trader.pubkey(), &env.usdc_mint)),
        env.balance(&ata(&trader.pubkey(), &l.mint)),
        env.balance(&l.pool_usdc),
        env.balance(&l.pool_token),
        env.balance(&ata(&env.platform.pubkey(), &env.usdc_mint)),
        env.balance(&l.fee_vault),
        env.balance(&l.reserve_vault),
        env.balance(&pda(&[INFRA_SEED])),
    ]
}

/// Runs one trade and checks it against curve.ts, its own event and the vault balances.
#[track_caller]
fn check_trade(env: &mut Env, l: &Listing, trader: &Keypair, side: Side, amount: u64) -> Traded {
    env.create_ata(trader, &l.mint);
    let before = snapshot(env, l, trader);
    let (pool_usdc, pool_tokens) = (before[2], before[3]);
    let logs = match side {
        Side::Buy => env.buy(l, trader, amount, 0),
        Side::Sell => env.sell(l, trader, amount, 0),
    }
    .unwrap();
    let after = snapshot(env, l, trader);
    let event = events::<Traded>(&logs).pop().expect("Traded event");
    let what = format!("{side:?} {amount}");

    assert_eq!(event.side, side);
    assert_eq!(
        event.fee_platform + event.fee_startup + event.fee_reserve + event.fee_infra,
        event.fee,
        "{what}"
    );
    assert_eq!(after[4] - before[4], event.fee_platform, "{what}");
    assert_eq!(after[5] - before[5], event.fee_startup, "{what}");
    assert_eq!(after[6] - before[6], event.fee_reserve, "{what}");
    assert_eq!(after[7] - before[7], event.fee_infra, "{what}");
    assert_eq!(
        (after[2], after[3]),
        (event.pool_usdc_after, event.pool_tokens_after),
        "{what}"
    );

    let quoted_fee = match side {
        Side::Buy => {
            let (fee, tokens_out) = quote_buy(ui(pool_usdc), ui(pool_tokens), ui(amount));
            assert_eq!(before[0] - after[0], amount, "{what}");
            assert_eq!(after[1] - before[1], event.token_amount, "{what}");
            assert_eq!(event.usdc_amount, amount);
            assert_eq!(after[2] - before[2], amount - event.fee, "{what}");
            assert_parity(event.token_amount, tokens_out, &what);
            fee
        }
        Side::Sell => {
            let (fee, usdc_out) = quote_sell(ui(pool_usdc), ui(pool_tokens), ui(amount));
            assert_eq!(before[1] - after[1], amount, "{what}");
            assert_eq!(after[0] - before[0], event.usdc_amount, "{what}");
            assert_eq!(event.token_amount, amount);
            assert_eq!(
                before[2] - after[2],
                event.usdc_amount + event.fee,
                "{what}"
            );
            assert_parity(event.usdc_amount, usdc_out, &what);
            fee
        }
    };
    assert!(
        (quoted_fee * 1e6 - event.fee as f64).abs() < 1.0 + NOISE,
        "{what}: fee {}",
        event.fee
    );
    // The pool never loses value to rounding.
    assert!(
        after[2] as u128 * after[3] as u128 >= pool_usdc as u128 * pool_tokens as u128,
        "{what}"
    );
    event
}

#[test]
fn trades_match_curve_ts_across_a_table_of_inputs() {
    let mut env = Env::new();
    let (l, holder) = env.live("ACME");
    let trader = env.user(60_000 * USDC);

    // Tiny, typical, awkward fractions, and larger than the whole pool.
    for usdc_in in [1, 10_000, USDC, 100 * USDC, 1_234_567_891, 20_000 * USDC] {
        check_trade(&mut env, &l, &trader, Side::Buy, usdc_in);
    }
    for tokens_in in [
        1_000,
        TOKENS,
        1_000 * TOKENS,
        123_456_789_012,
        10_000_000 * TOKENS,
    ] {
        check_trade(&mut env, &l, &holder, Side::Sell, tokens_in);
    }
    // Repeated trades: each one is quoted against the pool the previous one left.
    for _ in 0..5 {
        check_trade(&mut env, &l, &trader, Side::Buy, 777_777_777);
    }
    for _ in 0..3 {
        check_trade(&mut env, &l, &holder, Side::Sell, 500_000 * TOKENS);
    }
}

#[test]
fn fee_splits_30_30_20_20_and_the_remainder_goes_to_the_reserve() {
    let mut env = Env::new();
    let (l, _) = env.live("ACME");
    let trader = env.user(2_000 * USDC);

    let event = check_trade(&mut env, &l, &trader, Side::Buy, 1_000 * USDC);
    assert_eq!(event.fee, 10 * USDC);
    assert_eq!(
        (
            event.fee_platform,
            event.fee_startup,
            event.fee_reserve,
            event.fee_infra
        ),
        (3 * USDC, 3 * USDC, 2 * USDC, 2 * USDC)
    );
    // A fee of 9 base units cannot split evenly: 2 + 2 + 1 are rounded down, the reserve gets 4.
    let event = check_trade(&mut env, &l, &trader, Side::Buy, 999);
    assert_eq!(event.fee, 9);
    assert_eq!(
        (
            event.fee_platform,
            event.fee_startup,
            event.fee_reserve,
            event.fee_infra
        ),
        (2, 2, 4, 1)
    );
}

#[test]
fn trading_is_rejected_while_raising() {
    let mut env = Env::new();
    let l = env.list("ACME", 100_000 * USDC);
    let buyer = env.user(2_000 * USDC);
    env.commit(&l, &buyer, 1_000 * USDC).unwrap();
    assert_rejected(env.buy(&l, &buyer, 100 * USDC, 0), "NotLive");
    assert_rejected(env.sell(&l, &buyer, 100 * TOKENS, 0), "NotLive");
}

#[test]
fn slippage_limits_and_balances_are_enforced() {
    let mut env = Env::new();
    let (l, holder) = env.live("ACME");
    let trader = env.user(1_000 * USDC);

    let (_, quote) = quote_buy(19_500.0, 12_675_000.0, 100.0);
    let quoted = (quote * 1e6) as u64;
    assert_rejected(
        env.buy(&l, &trader, 100 * USDC, quoted + 2),
        "SlippageExceeded",
    );
    env.buy(&l, &trader, 100 * USDC, quoted - 1).unwrap();

    assert_rejected(
        env.sell(&l, &holder, 1_000 * TOKENS, 1_000 * USDC),
        "SlippageExceeded",
    );
    env.sell(&l, &holder, 1_000 * TOKENS, 1).unwrap();

    let held = env.balance(&ata(&trader.pubkey(), &l.mint));
    assert_rejected(env.sell(&l, &trader, held + 1, 0), "InsufficientBalance");
    assert_rejected(env.buy(&l, &trader, 5_000 * USDC, 0), "InsufficientBalance");
    assert_rejected(env.buy(&l, &trader, 0, 0), "InvalidAmount");
    assert_rejected(env.sell(&l, &trader, 0, 0), "InvalidAmount");
    // One base unit of token is worth less than one base unit of USDC here.
    assert_rejected(env.sell(&l, &trader, 1, 0), "TradeTooSmall");
}

#[test]
fn a_round_trip_costs_about_two_fees_and_never_pays() {
    let mut env = Env::new();
    let (l, _) = env.live("ACME");
    for usdc_in in [1, 137, USDC, 1_000 * USDC, 5_000 * USDC] {
        let trader = env.user(usdc_in);
        let usdc = ata(&trader.pubkey(), &env.usdc_mint);
        env.buy(&l, &trader, usdc_in, 0).unwrap();
        let tokens = env.balance(&ata(&trader.pubkey(), &l.mint));
        // Dust positions can be too small to sell at all; then the trader is simply down.
        let _ = env.sell(&l, &trader, tokens, 0);
        let back = env.balance(&usdc);
        assert!(back < usdc_in, "round trip of {usdc_in} returned {back}");
        if usdc_in >= USDC {
            let lost = (usdc_in - back) as f64 / usdc_in as f64;
            assert!(
                (0.0198..0.0200).contains(&lost),
                "round trip of {usdc_in} lost {lost}"
            );
        }
    }
}

#[test]
fn pause_blocks_buying_but_not_selling() {
    let mut env = Env::new();
    let (l, holder) = env.live("ACME");
    let trader = env.user(100 * USDC);
    env.pause(true);
    assert_rejected(env.buy(&l, &trader, 100 * USDC, 0), "Paused");
    env.sell(&l, &holder, 1_000 * TOKENS, 0).unwrap();
    env.pause(false);
    env.buy(&l, &trader, 100 * USDC, 0).unwrap();
}
