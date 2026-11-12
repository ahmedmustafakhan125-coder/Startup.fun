# Decisions

Choices made where the docs leave an option open. Newest phase at the bottom.

## Tool versions in use (recorded 2026-11-12, Phase 0)

| Tool | Version | Note |
|---|---|---|
| Solana CLI (Agave) | 3.1.10 | the `solana` MCP docs list 3.1.10+ for Anchor 1.x |
| Anchor CLI / `anchor-lang` | 1.1.2 (via `avm` 1.1.2) | the Solana quick start asks for 1.1.2 or higher |
| Rust (program builds) | 1.89.0 | pinned in `rust-toolchain.toml` by `anchor init` |
| LiteSVM | 0.10.0 | program test runtime |
| Node.js | 24.10.0 (22+ required) | |
| npm | 11.6.1 | package manager for `app/`, `server/`, `sdk/` |
| Fastify | 5.x | |
| Prisma | 7.x with `@prisma/adapter-better-sqlite3` | |
| TypeScript | 5.x | same major as the frontend |
| Vitest | 5.x | backend tests |

## Phase 0

1. **Program tests are Rust tests on LiteSVM.** This is the Anchor 1.x default template
   (`anchor test` runs `cargo test`, no local validator, no JS toolchain). The Phase 2 parity test
   will port `quoteBuy` and `quoteSell` from `app/src/lib/curve.ts` (PHASES.md allows "port or import").
2. **Program tests live in the root `tests/` folder**, as the layout in `CLAUDE.md` says. Cargo
   expects integration tests inside the crate, so each file is registered with a `[[test]]` entry
   in `programs/obverse/Cargo.toml`.
3. **The Phase 0 program has one placeholder instruction (`initialize`)** so the build produces an
   IDL and the test harness has something to call. Phase 1 replaces it with `initialize_config`.
4. **npm everywhere, no JS workspace.** `app/`, `server/` and `sdk/` each have their own
   `package.json`. Fewer moving parts than a root workspace; revisit in Phase 4 when `sdk/` gets
   real generated code that both sides import.
5. **Prisma 7 with the better-sqlite3 driver adapter.** Prisma 7 needs a driver adapter and a
   `prisma.config.ts`; the generated client goes to `server/src/generated/` (git-ignored, rebuilt
   by `npm install`). The schema has no models until Phase 6.
6. **The server refuses to start if `RPC_URL` contains "mainnet".** Cheap guard for the
   devnet-only rule.
7. **The program keypair stays in `target/deploy/` (git-ignored).** Only the public program ID is
   committed. Back the file up before Phase 4: the devnet address depends on it.
8. **Server default port is 8787**, bound to 127.0.0.1.

## Phase 1

1. **`create_startup` is two instructions.** Creating the startup, its mint and all ten token
   accounts in one instruction overflows the 4 KB SBF stack (the build reports it). `create_startup`
   creates the `Startup`, the mint and the four token-side accounts and mints the supply;
   `create_startup_vaults` creates the six USDC vaults. The operator sends both in one transaction,
   with a compute budget of 400,000 units. `commit` fails until the vaults exist.
2. **The 13M liquidity allocation waits in `pool_token`.** No separate holding account: the raise
   close burns what the pool does not need and leaves the rest in place.
3. **Callers pass token accounts that already exist.** `faucet`, `commit` and
   `pay_verification_fee` do not create accounts; clients put an idempotent
   associated-token-account instruction in front. Keeps `init_if_needed` out of the program.
4. **Account sizes.** `Config` is 437 bytes and `Startup` is 496 bytes, each including 256 zeroed
   `_reserved` bytes. The ticker has room for 16 bytes; the program accepts 3 to 5 capital
   letters, the same rule as the listing wizard. `Startup` already carries the Phase 2 and 3 fields.
5. **`commit` clamps to the remaining room** (ARCHITECTURE.md section 10 default). An amount too
   small to buy one base unit of token is rejected with `CommitTooSmall`.
6. **Fixed rules are not updatable.** `update_config` can change admin, operator, platform wallet,
   time units, verification fee, pause and the faucet flag. Fee split, listing fee, treasury share
   and lock lengths are set once at `initialize_config`.
7. **`initialize_config` makes its caller the admin.** Acceptable on devnet because the Phase 4
   deploy script calls it straight after deploying. Gate it on the program's upgrade authority
   before any deployment that holds real value (marked `shortcut:` in the code).
8. **No token metadata yet.** Skipped as section 10 allows; revisit in Phase 4 with the client.
9. **`anchor-spl` is pinned to `=1.1.2`.** Cargo otherwise picks 1.2.2, which does not compile
   against `anchor-lang` 1.1.2.
10. **Extra events `ConfigUpdated` and `FaucetUsed`**, so every state-changing instruction emits one.
11. **Tests set the LiteSVM clock** to a fixed real-looking time; it starts at unix time 0.
12. **The Solana docs MCP was queried over HTTP** (the same `mcp.solana.com` endpoint) because the
    server was not attached to the session. Its answer: in Anchor 1.x `CpiContext::new` takes the
    program id, not the program `AccountInfo`.

## Phase 2

1. **Rounding in trades.** The buy fee is `usdc_in * 1%` rounded down, so the pool receives at
   least the exact net amount. `tokens_out` (buy) and `usdc_out` (sell) are priced on the exact,
   unrounded 1% and rounded down; on a sell the fee is `gross - usdc_out`. Result: what the trader
   receives is within one base unit of `curve.ts` for every input and never above it, the fee is
   within one base unit, and the pool's `usdc * tokens` never falls. A naive "round the fee, then
   price" would drift by hundreds of token base units on amounts that are not a multiple of 100
   base units of USDC.
2. **Parity test ports `quoteBuy` and `quoteSell` to Rust** (f64, line for line) in
   `tests/phase2.rs`, with 0.05 base units of slack for f64 noise.
3. **Pool reserves are the token account balances** of `pool_usdc` and `pool_token`. Tokens sent
   straight to those accounts act as a donation to the pool.
4. **`Traded.price_after` is USDC per token scaled by 1e12.** The event also carries both pool
   reserves after the trade, which is what the indexer should chart from.
5. **Selling is not blocked by `paused`.** The rule says pause blocks commit, buy and claims;
   holders can always exit.
6. **Named errors for balance and dust:** `InsufficientBalance` and `TradeTooSmall`.
7. **`buy` and `sell` share one accounts struct (`Trade`)**; `claim_treasury` and `claim_fees`
   share `FounderClaim`.

## Phase 3

1. **Platform token claims need Green too**, the same as founder claims ("same schedule").
2. **A repeated Red report keeps the original `red_since`.**
3. **`wind_down` is not blocked by `paused`**, and neither is `claim_refund`.
4. **Refunds round down per claim**, so the refund vault can always pay the last holder; a few
   base units of dust can stay behind.
5. **`wind_down` adds anything already in `refund_vault`** to the refund pool.
6. **A claim that would pay zero is rejected with `NothingToClaim`** (second claim in a period,
   empty vault, nothing vested yet).

## Phase 4

1. **New program ID `9dCBaMA4rwxAhnAh9mKbmr27FTakFVZ2KdcbyjyZpm7j`.** The Phase 0 keypair did not
   come along when the project moved machines, so a new one was generated and adopted with
   `anchor keys sync` before the first deploy. Back up `target/deploy/obverse-keypair.json`.
2. **TypeScript client: Codama + `@solana/kit`** (the Solana docs MCP points to
   `@codama/nodes-from-anchor` and `@codama/renderers-js`). `cd sdk && npm run generate` writes
   `sdk/src/generated/`, which is committed together with the IDL copy in `sdk/idl/`. The async
   instruction builders derive every PDA from the startup address.
3. **Scripts are TypeScript run with `tsx`**, in their own `scripts/package.json`, importing the
   client by relative path. Still no root JS workspace.
4. **Scripts confirm by polling and back off on HTTP 429.** The public devnet endpoint limits per
   IP; no websocket subscriptions are used.
5. **Script wallets live in `keypairs/`** (git-ignored): operator, founder, buyer, holder. The
   admin and platform wallet are the deploy wallet unless `PLATFORM_WALLET` is set.
6. **All seeded startups share the `founder` script wallet**, so the demo and later phases can
   sign founder actions. One `buyer` wallet fills the raises.
7. **Seed data is copied into `scripts/seed.ts`** (ticker, target, raised, budget, cap, state)
   rather than imported from the app, whose seed module builds UI objects.
8. **The on-chain IDL upload that `anchor deploy` attempts failed** (metadata program error) and
   is not needed: clients use the committed IDL and generated code.

## Phase 5

1. **Wallet connection: the Wallet Standard, through `@wallet-standard/app`.** The Solana docs MCP
   shows Kit's own React example signing through Wallet Standard features. The store is not
   hook-based, so the app talks to the standard directly: it finds the installed wallet that
   holds the connected address and calls `solana:signTransaction`. The existing Phantom connect
   button is unchanged. The demo wallet is offered in mock mode only.
2. **The wallet signs, the app sends.** The signed transaction goes to the app's own devnet RPC
   and is confirmed by polling. That gives the two button states ("Waiting for wallet",
   "Confirming") and does not depend on which network the wallet extension is set to.
3. **Live mode is a set of overrides in `app/src/store/live.ts`.** Mock actions are untouched;
   money actions now may return a promise, and the pages await them. Live state is saved under
   its own storage key.
4. **1% slippage limit** on live buys and sells, taken from the quote on screen.
5. **Still sample data in live mode:** startup profiles (matched by ticker; unknown tickers get a
   blank profile), the application queue and the admin numbers. Backers, volume, price history
   and total fees claimed read as zero or two points until the indexer exists (Phases 6 and 8).
   The trade list shows only this browser's own trades.
6. **Cost basis in live mode is local.** Tokens first seen are valued at the current price;
   after that the browser keeps a running cost. The indexer replaces this in Phase 8.
7. **Days of silence are scaled** from on-chain seconds: one on-chain month shows as 30 days.
8. **"Advance one month" is hidden in live mode.** Admin shows the on-chain clock rule, and each
   startup card on the Founder page shows its month and a countdown to the next reset.
9. **The 429 backoff RPC client moved to `sdk/src/rpc.ts`** and is shared by the app and scripts.
10. **Verified without Phantom.** Faucet, commit, buy, sell, treasury claim, fee claim and refund
    were run on devnet through the live store in Node, with a stand-in Wallet Standard wallet
    signing with a script key. A buy quoted 160,013.410303 tokens and received 160,013.410302.
    Not yet run on devnet: the founder token claim (nothing unlocks before month 13) and the
    real Phantom popup.
