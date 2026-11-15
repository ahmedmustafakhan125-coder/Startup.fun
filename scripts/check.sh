#!/usr/bin/env bash
# Every program, backend and build check in one command.   scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# `anchor build` switches the machine's active Solana CLI to the version Anchor wants; put it back after.
active=~/.local/share/solana/install/active_release
before=$(readlink "$active" 2>/dev/null || true)
restore() { [ -n "$before" ] && ln -sfn "$before" "$active"; }
trap restore EXIT

echo "== program: build and tests";   CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-1} anchor test
echo "== sdk: type check";            (cd sdk && npx tsc --noEmit)
echo "== server: type check and tests"; (cd server && npm run -s typecheck && npm test --silent)
echo "== app: type check and build";  (cd app && npm run -s build)
echo "== scripts: type check"
sdk/node_modules/.bin/tsc --noEmit --allowImportingTsExtensions --module esnext --moduleResolution bundler --target es2022 \
  --strict --skipLibCheck --types node --typeRoots sdk/node_modules/@types scripts/*.ts
echo "All checks passed."
