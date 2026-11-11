# Obverse (working name)

Frontend for a Solana devnet platform where verified startups raise into escrow and get a tradeable token.
Money releases month by month only while the startup's verification checks keep passing (the "heartbeat").
After 60 silent days the startup winds down and what is left is refunded to holders.

The name lives in `src/config.ts` (`BRAND`). Change it there.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static build in dist/
npm run build:preview  # one self-contained index.html in dist-preview/
```

## Screens

| Route | Screen |
|---|---|
| `/` | Home: coin hero (click to flip), outcome cards, trading now, open raises, fee split |
| `/explore` | All startups: search, category, sort, status filters |
| `/s/:id` | Startup: price chart, buy/sell or commit or refund, vaults, verification checklist, heartbeat bars, trades |
| `/list` | Listing wizard: founder, startup, verification (DNS code, GitHub, socials, KYC), raise and budget, review and pay |
| `/founder` | Founder: application timeline, monthly treasury claim, capped fee claim, token vesting, heartbeat checks |
| `/portfolio` | Holdings, gain/loss, refunds, activity, demo USDC faucet |
| `/admin` | Revenue, daily volume, escrow, review queue (approve, schedule, reject, list now), heartbeat controls, demo month clock |

## How it is wired

- `src/store/useStore.ts` is the whole mock backend. Every action (buy, sell, commit, submitApplication,
  adminSchedule, adminAdvanceMonth, founderClaimTreasury, claimRefund ...) maps to one future API call or
  Anchor instruction. Pages never change data directly, so swapping the store for real calls is contained.
- `src/lib/curve.ts` holds the pricing and payout rules (constant-product pool, fee split, claimable amounts,
  vesting, refund floor). Port these rules to the Anchor program.
- `src/config.ts` holds every number: supply split, the 1% fee split, verification fee, listing fee,
  12-month cliff, 24-month vest, 60-day wind-down, 7 to 14 day review window.
- State persists in localStorage. Admin has "Reset demo data".
- Wallet: a demo wallet, plus Phantom detection. Balances are demo USDC until the program is on devnet.

## Rules implemented

- Supply: 65% sold in the raise, 13% liquidity, 20% founders, 2% platform.
- Raise closes: 2.5% listing fee, 80% of the rest locks in the treasury, 20% seeds the pool.
- Each trade: 1% fee = 0.30% platform, 0.30% startup fee vault, 0.20% holder reserve, 0.20% infrastructure.
- Founders claim at most their monthly budget from the treasury and their monthly cap from the fee vault,
  and only while the heartbeat is green.
- Founder tokens: locked 12 months, then released evenly over 24, paused while silent.
- 60 silent days: treasury, fee vault, holder reserve and pool are refunded pro rata; founder tokens burned.
