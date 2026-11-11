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
