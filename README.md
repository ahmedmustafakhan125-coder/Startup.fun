# Obverse (working name)

A Solana **devnet** platform where verified startups raise into escrow and get a tradeable token.
Money releases to founders month by month only while their verification checks keep passing.
After 60 silent days the startup winds down and what is left is refunded to token holders.

Devnet only. Demo funds only.

## Layout

| Folder | What |
|---|---|
| `app/` | React + Vite + Tailwind frontend. Runs on mock data today |
| `programs/obverse/` | Anchor program |
| `tests/` | Program tests (Rust, LiteSVM) |
| `server/` | Node + TypeScript backend (Fastify, Prisma, SQLite) |
| `sdk/` | Generated program client and shared types |
| `scripts/` | Devnet deploy, init, seed and demo scripts (from Phase 4) |

Docs: `ARCHITECTURE.md` (rules and formulas), `PHASES.md` (build order and progress),
`INSTRUCTIONS.md` (setup), `DECISIONS.md` (choices and tool versions).

## Requirements

Node.js 22+, Rust, Solana CLI 3.1.10+, Anchor CLI 1.1.2 (via `avm`). On Windows use WSL2.

## Run each part

### Frontend

```bash
cd app
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
```

Mock mode is the default and needs no configuration. See `app/.env.example` for live-mode variables.

### Program

```bash
anchor build     # compiles to target/deploy/obverse.so and writes the IDL to target/idl/
anchor test      # builds, then runs the Rust tests in tests/ on LiteSVM
```

### Backend

```bash
cd server
cp .env.example .env    # then fill in what you need; .env is git-ignored
npm install             # also generates the Prisma client
npm run dev             # http://127.0.0.1:8787
curl http://127.0.0.1:8787/health
npm test
```

## Secrets

Keypairs and API keys never go in git. They live in `.env` files and keypair files that
`.gitignore` excludes. Only `.env.example` files, with empty values, are committed.
