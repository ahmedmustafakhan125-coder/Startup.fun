# Obverse (working name)

A Solana **devnet** platform where verified startups raise into escrow and get a tradeable token.
Money releases to founders month by month only while their verification checks keep passing.
After 60 silent days the startup winds down and what is left is refunded to token holders.

Devnet only. Demo funds only. Deployed addresses are in `ADDRESSES.md`.

## Layout

| Folder | What |
|---|---|
| `app/` | React + Vite + Tailwind frontend. Mock mode (sample data) or live mode (devnet + backend) |
| `programs/obverse/` | Anchor program |
| `tests/` | Program tests (Rust, LiteSVM) |
| `server/` | Node + TypeScript backend (Fastify, Prisma, SQLite): API, checks, heartbeat, AI review, indexer |
| `sdk/` | Generated program client (Codama, `npm run generate`) and shared helpers |
| `scripts/` | Devnet init, seed, demo and walkthrough scripts, and `check.sh` (see `scripts/README.md`) |

Docs: `ARCHITECTURE.md` (rules and formulas), `PHASES.md` (build order and progress),
`INSTRUCTIONS.md` (setup), `DECISIONS.md` (choices, tool versions, known limits).

## Requirements

Node.js 22+, Rust, Solana CLI 3.1.10+, Anchor CLI 1.1.2 (via `avm`). On Windows use WSL2.

## Check everything

```bash
scripts/check.sh   # program build + tests, sdk, server tests, app build, scripts type check
```

## Run each part

### Program

```bash
anchor build     # compiles to target/deploy/obverse.so and writes the IDL to target/idl/
anchor test      # builds, then runs the Rust tests in tests/ on LiteSVM
```

After a deploy: `cd scripts && npm install && npm run init` once (config, demo USDC, operator key).

### Backend

```bash
cd server
cp .env.example .env    # then fill in: SESSION_SECRET, ADMIN_WALLETS, OPERATOR_KEYPAIR_PATH
npm install             # also generates the Prisma client
npm run db:migrate      # create or update the database
npm run db:seed         # optional: profiles for the sample startups from scripts/seed.ts
npm run dev             # http://127.0.0.1:8787
npm test
```

One process runs the API and three timers: the listing job, the indexer and the heartbeat job.

### Frontend

```bash
cd app
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
```

Mock mode is the default and needs no configuration. For live mode, copy `app/.env.example` to
`app/.env.local`, set `VITE_DATA_SOURCE=live` and point `VITE_API_PROXY` at the backend. Live mode
needs a Wallet Standard wallet (for example Phantom) set to devnet, with a little devnet SOL for fees.

## What is real and what is mocked

| Part | Status |
|---|---|
| Program: raise, pool, fees, claims, heartbeat, wind-down, refunds | Real, on devnet |
| USDC | A demo mint with a faucet (5,000 per call) |
| Domain check | Real: DNS TXT record and an HTTPS request. `DOMAIN_MODE=mock` exists for scripted demos only |
| Code check | Real GitHub OAuth when `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set; otherwise a mock pass. The heartbeat's commit-activity check is real |
| Identity (KYC) and social accounts | Mocked: they always pass. No documents are collected |
| Founder details | An admin confirms them by hand ("Re-run checks") |
| AI review | Real with `AI_API_KEY` (Gemini); without it the job runs and the row says "Not available yet" |
| Indexer, trades, charts, admin numbers | Real, from on-chain events |
| Heartbeat reporting | One operator key on the backend (the first thing to decentralise) |

## Secrets

Keypairs and API keys never go in git. They live in `.env` files and keypair files that
`.gitignore` excludes (`keypairs/`, `target/deploy/*-keypair.json`). Only `.env.example` files
are committed. Back up `target/deploy/obverse-keypair.json` and `keypairs/`.
