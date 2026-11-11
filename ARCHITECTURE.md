# Architecture

## 1. The product in one paragraph

A founder applies to list a startup and proves they control its domain, code and social accounts.
After an admin approves it, the startup gets a token and a fixed-price raise. When the raise closes,
80% of the proceeds lock in a treasury, 20% becomes trading liquidity, and the token trades with a 1%
fee. The founder can claim a capped amount from the treasury and from trading fees each month, but only
while a recurring set of checks (the heartbeat) keeps passing. If the checks fail for 60 days, the
startup winds down: everything left is refunded to token holders and the founders' locked tokens burn.

## 2. System overview

```
                      ┌──────────────────────────────┐
   Browser            │  app/  React frontend        │
   (Phantom etc.)     │  store actions               │
                      └───────┬──────────────┬───────┘
          signs transactions  │              │  HTTPS (JSON)
                              ▼              ▼
              ┌───────────────────┐   ┌──────────────────────────────┐
              │ Solana devnet     │   │ server/  Node backend        │
              │ programs/obverse  │◄──┤  API + auth                  │
              │  config, startups │   │  verification checks         │
              │  vaults, pool     │──►│  heartbeat job (operator key)│
              └───────────────────┘   │  AI review                   │
                 events (logs)        │  indexer + stats             │
                                      │  database                    │
                                      └──────────────────────────────┘
```

| Part | Owns | Never does |
|---|---|---|
| Program | all money and tokens, every payout rule | call the internet, trust the frontend |
| Backend | applications, checks, heartbeat decisions, AI review, trade history, admin numbers | hold user funds, move money outside program rules |
| Frontend | display, building transactions for the wallet to sign | hold keys, decide rules |

The backend is trusted for one thing: reporting heartbeat status. That is acceptable on devnet and is
the first thing to decentralise later (several independent signers instead of one operator key).

## 3. Numbers (source of truth: `app/src/config.ts`)

| Item | Value |
|---|---|
| Token supply | 100,000,000, 6 decimals |
| Sold in the raise | 65,000,000 (65%) |
| Trading liquidity | 13,000,000 (13%) |
| Founders | 20,000,000 (20%), locked |
| Platform | 2,000,000 (2%), same lock |
| Trade fee | 1.00% = platform 0.30% + startup fee vault 0.30% + holder reserve 0.20% + infrastructure 0.20% |
| Verification fee | 300 USDC per application |
| Listing fee | 2.5% of a closed raise |
| Treasury share | 80% of net proceeds (the other 20% seeds the pool) |
| Founder lock | 12 months, then even release over 24 months |
| Wind-down | 60 silent days |
| Review promise | 7 to 14 days |

USDC on devnet is a demo mint created by this project (6 decimals) with a faucet.

### Time on devnet

Real months are useless for a demo, so the program's time units are configurable:

| Config field | Production | Devnet default |
|---|---|---|
| `month_seconds` | 2,592,000 (30 days) | 300 (5 minutes) |
| `winddown_seconds` | 5,184,000 (60 days) | 600 (two "months") |

All lock, cap and wind-down logic uses these fields, never hard-coded durations.

## 4. Solana program (`programs/obverse`, Anchor)

One program. SPL Token (classic), not Token-2022. Confirm current Anchor syntax with the Solana MCP.

### 4.1 Accounts

| Account | Seeds | Holds |
|---|---|---|
| `Config` | `["config"]` | `admin`, `operator`, `usdc_mint`, `platform_wallet`, fee bps, listing fee bps, treasury share bps, `month_seconds`, `winddown_seconds`, `cliff_months`, `vest_months`, `verification_fee`, `paused` |
| `Startup` | `["startup", ticker]` | founder, token mint, phase, raise target, raised, monthly budget, fee cap, timestamps, heartbeat fields, claim counters, refund snapshot (see 4.3) |
| Vault authority | `["vault", startup]` | PDA that owns every token account below |
| Token accounts | ATA or seeded per startup | `raise_vault`, `treasury_vault`, `fee_vault`, `reserve_vault`, `pool_usdc`, `pool_token`, `sale_vault`, `founder_lock`, `platform_lock`, `refund_vault` |
| `infra_vault` | `["infra"]` | the 0.20% infrastructure share (see section 9, decision 1) |

**Account sizing (owner rule).** `Config` and `Startup` are allocated larger than their current fields
need, so new fields can be added after the devnet deploy without resizing existing accounts. Each
ends with a zeroed `_reserved` byte array, and variable-length fields (ticker and any other strings)
get a generous fixed maximum. A new field is added by taking bytes from `_reserved`, keeping the total
size and the existing field order unchanged. The chosen sizes are recorded in `DECISIONS.md`. Changing
the program's logic still needs a program upgrade; the reserve only removes the need to reallocate or
migrate accounts.

- `admin`: the human admin wallet. Can update config and pause.
- `operator`: the backend's key. Can list startups, close raises, report heartbeats.

### 4.2 Instructions

| Instruction | Signer | What it does |
|---|---|---|
| `initialize_config` | deployer | creates `Config`, the demo USDC mint and `infra_vault` |
| `update_config` | admin | changes config fields, pause flag |
| `faucet(amount)` | anyone | mints up to 5,000 demo USDC per call to the caller (devnet only, behind a config flag) |
| `pay_verification_fee(application_id)` | founder | transfers 300 USDC to `platform_wallet`, emits an event the backend matches to the application |
| `create_startup(args)` | operator | creates `Startup`, mints 100M tokens into `sale_vault` (65M), a liquidity holding account (13M), `founder_lock` (20M), `platform_lock` (2M), then removes mint authority. Phase = Raising |
| `commit(usdc_in)` | buyer | Raising only. Takes USDC into `raise_vault`, sends tokens at the fixed price. Closes the raise automatically when the target is reached |
| `close_raise` | operator | closes a raise early if anything was committed |
| `buy(usdc_in, min_tokens_out)` | trader | Live only. Constant-product swap with the 1% fee |
| `sell(tokens_in, min_usdc_out)` | trader | Live only. Same, other direction |
| `report_heartbeat(status)` | operator | sets Green or Red, maintains `red_since` and `red_seconds_total` |
| `claim_treasury` | founder | Live + Green. Pays up to this period's remaining budget |
| `claim_fees` | founder | Live + Green. Pays up to this period's remaining fee cap |
| `claim_founder_tokens` | founder | Live + Green. Releases vested tokens |
| `claim_platform_tokens` | admin | same schedule, to the platform wallet |
| `wind_down` | anyone | Live + Red for at least `winddown_seconds`. Moves all funds to `refund_vault`, burns locked and pool tokens, snapshots the refund rate |
| `claim_refund(amount)` | holder | WoundDown. Burns the holder's tokens, pays their share |

Every instruction that changes state emits an event: `ApplicationFeePaid`, `StartupListed`, `Committed`,
`RaiseClosed`, `Traded`, `HeartbeatReported`, `TreasuryClaimed`, `FeesClaimed`, `TokensClaimed`,
`WoundDown`, `Refunded`. `Traded` carries side, amounts, price after the trade and the four fee parts.

### 4.3 Rules and formulas

All amounts are integers in base units. Use `u128` for intermediate products. Divide last, round down
for anything paid out, and send rounding remainders to the holder reserve.

**Raise**

```
tokens_out      = usdc_in * 65,000,000 / raise_target
commit requires   usdc_in <= raise_target - raised   (clamp or reject, be consistent)
```

**Closing a raise** (automatic at target, or `close_raise`)

```
listing_fee  = raised * 2.5%            -> platform_wallet
net          = raised - listing_fee
pool_usdc    = net * 20%                -> pool_usdc
treasury     = net - pool_usdc          -> treasury_vault
pool_tokens  = min(13,000,000, pool_usdc * 65,000,000 / raise_target)   -> pool_token
burn           unsold sale tokens and unused liquidity tokens
live_at      = now ; phase = Live ; heartbeat = Green
```

The pool opens at the raise price.

**Trading** (constant product, fee taken on the USDC side)

```
buy:   fee = usdc_in * 1%
       net = usdc_in - fee
       tokens_out = pool_tokens * net / (pool_usdc + net)
sell:  gross = pool_usdc * tokens_in / (pool_tokens + tokens_in)
       fee = gross * 1%
       usdc_out = gross - fee
fee split: platform 30%, startup fee vault 30%, holder reserve 20%, infrastructure 20% of the fee
```

Trading stays open while the heartbeat is red. The frontend shows a warning.

**Periods and caps**

```
period = (now - live_at) / month_seconds
claim_treasury: if period > last_treasury_period, reset claimed_this_period
                pay min(treasury_vault balance, monthly_budget - claimed_this_period)
claim_fees:     same, with fee_cap and fee_vault
```

Unused budget does not carry over to the next period.

**Founder vesting** (time only counts while green)

```
green_elapsed = (now - live_at) - red_seconds_total - (heartbeat is Red ? now - red_since : 0)
months        = green_elapsed / month_seconds            (whole months)
vested        = 20,000,000 * clamp((months - 12) / 24, 0, 1)
claimable     = vested - founder_claimed                 (only while Green)
```

**Heartbeat**

```
Green -> Red:   red_since = now
Red -> Green:   red_seconds_total += now - red_since ; red_since = 0
Green report:   last_beat = now
```

**Wind-down**

```
requires  phase = Live, heartbeat = Red, now - red_since >= winddown_seconds
refund_pool = treasury_vault + fee_vault + reserve_vault + pool_usdc     -> refund_vault
burn        founder_lock, platform_lock, pool_token
circulating = token mint supply after the burns
phase       = WoundDown
claim_refund(amount): burn amount, pay amount * refund_pool / circulating
```

### 4.4 Security checklist for the program

- Every account is checked: owner, mint, seeds, and that it belongs to the `Startup` passed in.
- Signer checks on every privileged instruction (`admin`, `operator`, `founder`).
- Phase checks first, then heartbeat checks, then amounts.
- Checked maths everywhere. No `unwrap` on arithmetic.
- Slippage limits on `buy` and `sell`.
- Mint authority removed after `create_startup`, so supply can only go down.
- `paused` blocks commit, buy and claims, but never `claim_refund`.

## 5. Backend (`server/`)

Node 22, TypeScript, Fastify, Prisma. SQLite on devnet (one file, no setup); the schema must stay
compatible with Postgres. One process runs the API and the scheduled jobs.

### 5.1 Auth

Sign-in with a wallet: the server issues a nonce, the wallet signs it, the server verifies the
signature and sets a session cookie. Admin routes require the wallet to be in `ADMIN_WALLETS`.

### 5.2 Data model

| Table | Purpose |
|---|---|
| `users` | wallet address, created date |
| `applications` | everything from the listing form, status (`submitted`, `in_review`, `scheduled`, `rejected`, `listed`), scheduled date, rejection reason, fee payment signature |
| `checks` | one row per application or startup per check: status, detail, checked time |
| `startups` | off-chain profile: name, ticker, tagline, about, category, country, links, founders, on-chain address, mint |
| `updates` | founder's monthly progress notes |
| `heartbeat_runs` | each run's per-check results, the combined verdict, whether it was reported on-chain and the signature |
| `ai_reviews` | score, verdict, reasons, evidence links, model and prompt version |
| `flags` | cases where rule checks and AI review disagree, with admin resolution |
| `trades` | indexed from `Traded` and `Committed` events |
| `daily_stats` | volume and platform revenue by source per day |
| `audit_log` | every admin action and operator transaction |

### 5.3 Verification checks (application time)

| Check | How | Devnet |
|---|---|---|
| Founder identity (KYC) | provider adapter with a sandbox mode | mock adapter that passes; no documents collected |
| Domain ownership | DNS TXT record `obverse-verify=<code>` on the domain, plus an HTTPS request that must succeed | real |
| Code repository | GitHub OAuth; confirm the signed-in user owns or administers the repo or org; read recent commits | real when OAuth keys are set, otherwise mock |
| Social account | provider adapter (OAuth sign-in to prove control) | mock unless keys are set |
| Founder details | an admin compares the details by hand | real (admin action) |

Each check sits behind an interface, so a mock and a real implementation are interchangeable by env var.

**Approval gate (owner rule).** An admin can approve only an application whose five checks have all
passed. The server enforces this, not just the UI: `/schedule` and `/list-now` reject with a named
error while any check is `pending` or `failed`, and the scheduled listing job re-checks all five
immediately before it sends `create_startup`, so a check that fails after approval stops the listing.
Rejecting an application is always allowed.

### 5.4 Heartbeat job

Runs on a schedule (`HEARTBEAT_INTERVAL`: daily in production, every 60 seconds on devnet) for every
Live startup.

| Heartbeat check | Passes if |
|---|---|
| Website | domain responds and the TXT record is still present |
| Code | commits or releases within the last 30 days (one period) |
| Socials | account still controlled by the founder and active within one period |
| Monthly update | the founder posted an update within the current or previous period |

Decision rule:

- A run is **failing** when two or more checks fail.
- Red after `RED_AFTER_RUNS` failing runs in a row (7 in production, 2 on devnet).
- Green again after one passing run.
- On a change, the operator key sends `report_heartbeat`. Green runs also refresh `last_beat`.
- An admin can force Green or Red with a written reason. The override holds until the admin clears it,
  and it is written to `audit_log`.

### 5.5 AI review

A second opinion on whether the work is real. It runs weekly per startup (every N runs on devnet).

- **Input:** a compact summary only: commit messages and diff statistics, the latest founder update,
  a text snapshot of the website and what changed since last time, recent post text.
- **Output (strict JSON):** `score` 0 to 100, `verdict` (`active`, `unclear`, `inactive`), `reasons[]`,
  `evidence[]` (links).
- **Provider:** behind one function, `reviewStartup(input)`. Gemini by default; any model with
  structured output can replace it by changing the adapter.
- **Combination with the rule checks:**

| Rule checks | AI review | Result |
|---|---|---|
| passing | active | Green |
| failing | inactive | Red (through the normal rule) |
| passing | inactive | flag for admin |
| failing | active | flag for admin |

- The AI review never changes the heartbeat on its own. Disagreements create a `flags` row for a person.
- **Prompt injection:** founders control the text being reviewed. The system prompt states that all
  supplied content is untrusted data; inputs are length-limited and wrapped in clear delimiters; the
  output is validated against the JSON schema and discarded if it does not match.
- Low temperature, versioned prompt, every verdict stored with its reasons so it can be shown publicly.

### 5.6 Indexer and stats

Subscribes to the program's logs, decodes Anchor events, and backfills by signature on start-up so a
restart loses nothing. Writes `trades` and updates `daily_stats`. Price history for charts comes from
`trades`. Revenue by source = trading fees (0.30%), listing fees, verification fees.

### 5.7 Scheduled listing

When an admin approves an application with a date, a job lists it at that time by sending
`create_startup` with the operator key. "List now" does the same immediately.

### 5.8 API

| Method and path | Who | Purpose |
|---|---|---|
| `POST /auth/nonce`, `POST /auth/verify`, `POST /auth/logout`, `GET /me` | anyone | wallet sign-in |
| `GET /startups`, `GET /startups/:id` | anyone | profile + cached on-chain state + checks + latest AI review |
| `GET /startups/:id/trades`, `/history`, `/updates` | anyone | trade list, price series, founder updates |
| `GET /wallets/:address/positions` | anyone | cost basis and activity for the portfolio page |
| `POST /applications` | founder | submit, with the fee payment signature |
| `GET /applications/mine` | founder | status and timeline |
| `POST /applications/:id/verify/:check` | founder | run or start a check (domain, github, socials, kyc) |
| `POST /startups/:id/updates` | founder | post a monthly update |
| `GET /admin/stats?range=` | admin | revenue, volume, escrow, counts |
| `GET /admin/applications` | admin | review queue |
| `POST /admin/applications/:id/run-checks`, `/schedule`, `/reject`, `/list-now` | admin | review actions |
| `POST /admin/startups/:id/close-raise` | admin | close a raise early |
| `POST /admin/startups/:id/heartbeat` | admin | override with a reason, or clear it |
| `GET /admin/flags`, `POST /admin/flags/:id/resolve` | admin | AI disagreements |

## 6. Frontend wiring (`app/`)

The UI is done. Wiring means replacing the inside of the store's actions.

- `VITE_DATA_SOURCE=mock` keeps today's behaviour. `live` uses the chain and the API.
- New folders: `app/src/chain/` (program client, transaction builders, account readers) and
  `app/src/api/` (typed HTTP client). Pages keep calling the same store actions.
- Real wallet connection through the wallet library the Solana MCP currently recommends. Keep the
  demo wallet for mock mode.

| Store action today | Live mode |
|---|---|
| `airdrop` | `faucet` instruction |
| `commit`, `buy`, `sell`, `claimRefund` | matching instruction, signed by the wallet |
| `founderClaimTreasury`, `founderClaimFees`, `founderClaimTokens` | matching instruction |
| `submitApplication` | `pay_verification_fee`, then `POST /applications` |
| wizard "verify" buttons | `POST /applications/:id/verify/:check` |
| `adminRunChecks`, `adminSchedule`, `adminReject`, `adminListNow`, `adminCloseRaise` | admin API |
| `adminSetHeartbeat` | admin heartbeat override API |
| `adminAdvanceMonth` | removed in live mode; show the current period and a countdown to the next one |
| startup lists, trades, admin numbers | API, with on-chain balances read through `app/src/chain/` |

Small additions the backend needs from the UI (match the existing style, add nothing else):

- Founder page: a "Post monthly update" form and the list of past updates.
- Startup page: founder updates, and an "AI review" row in the verification list with its verdict and reasons.
- Admin page: a "Flagged" tab in the review area, with resolve actions.
- Transaction states on buttons: waiting for wallet, confirming, confirmed with an explorer link, failed with the reason.

## 7. Environment variables

| Where | Variable | Meaning |
|---|---|---|
| app | `VITE_DATA_SOURCE` | `mock` or `live` |
| app | `VITE_API_URL`, `VITE_RPC_URL`, `VITE_PROGRAM_ID` | endpoints and program address |
| server | `RPC_URL`, `PROGRAM_ID` | devnet endpoint and program address |
| server | `OPERATOR_KEYPAIR_PATH` | backend signing key (git-ignored file) |
| server | `ADMIN_WALLETS` | comma-separated admin wallet addresses |
| server | `DATABASE_URL`, `SESSION_SECRET` | storage and sessions |
| server | `HEARTBEAT_INTERVAL`, `RED_AFTER_RUNS`, `AI_REVIEW_EVERY_RUNS` | job timing |
| server | `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | AI review |
| server | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth |
| server | `KYC_MODE`, `SOCIAL_MODE` | `mock` or a provider name |

## 8. Testing

| Layer | What |
|---|---|
| Program | one test per instruction for success and for each rejection; a parity test against `app/src/lib/curve.ts`; a full lifecycle test (raise, trade, claims, red, wind-down, refunds) with short periods |
| Backend | unit tests for the heartbeat decision rule and the AI combination table; API tests with mock adapters; an indexer test that replays recorded events |
| Frontend | existing mock-mode behaviour must keep working; a scripted live-mode walkthrough on devnet |

## 9. Decisions already made (do not reopen without asking)

1. **Own pool on devnet.** The program includes a simple constant-product pool that matches
   `curve.ts` exactly. A third-party launch pool (for example Meteora's bonding curve) is a later
   option, not part of this build. The 0.20% infrastructure share still gets collected, into `infra_vault`.
2. **Short months on devnet.** `month_seconds = 300`. The "Advance one month" button goes away in live mode.
3. **SQLite on devnet**, Postgres-compatible schema.
4. **KYC and social checks are mocked** unless provider keys are supplied.
5. **Tokens are not shares.** No wording or feature may suggest equity or ownership of the company.

## 10. Open points (use the default, note it in `DECISIONS.md`)

| Question | Default |
|---|---|
| A raise that never fills | no deadline; the admin can close it early once something is committed |
| `commit` above the remaining room | clamp to the remaining room (the frontend does this) |
| Token metadata (name, symbol, image) | add standard metadata if the Solana MCP shows a simple current way; otherwise skip |
| Heartbeat for a startup still raising | not tracked on-chain until it is Live |
