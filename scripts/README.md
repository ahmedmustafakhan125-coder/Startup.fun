# scripts

Devnet only. Each script prints a Solana Explorer link for every transaction it sends.

```bash
cd scripts
npm install
npm run init    # once after a deploy: config, demo USDC mint, operator key
npm run seed    # lists the sample startups so every lifecycle state exists on-chain
npm run demo    # walks one new startup from listing to refunds (about 11 minutes)
```

- The admin is the deploy wallet (`~/.config/solana/id.json`, or `ADMIN_KEYPAIR_PATH`). It pays for everything.
- Script wallets (`operator`, `founder`, `buyer`, `holder`) are created on first use in `keypairs/`,
  which is git-ignored. Point the server's `OPERATOR_KEYPAIR_PATH` at `keypairs/operator.json`.
- `RPC_URL` overrides the public devnet endpoint. The scripts back off when it rate-limits.
- `init` and `seed` are safe to run again; they skip what already exists.
- Addresses are not hard-coded: the program ID comes from the generated client in `sdk/`, and the
  config and demo USDC mint are derived from it. `npm run init` prints all three.
