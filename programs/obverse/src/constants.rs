// Every number must match app/src/config.ts. Amounts are base units (6 decimals).

pub const CONFIG_SEED: &[u8] = b"config";
pub const USDC_SEED: &[u8] = b"usdc";
pub const INFRA_SEED: &[u8] = b"infra";
pub const STARTUP_SEED: &[u8] = b"startup";
pub const VAULT_SEED: &[u8] = b"vault";
pub const MINT_SEED: &[u8] = b"mint";
pub const RAISE_VAULT_SEED: &[u8] = b"raise_vault";
pub const TREASURY_VAULT_SEED: &[u8] = b"treasury_vault";
pub const FEE_VAULT_SEED: &[u8] = b"fee_vault";
pub const RESERVE_VAULT_SEED: &[u8] = b"reserve_vault";
pub const REFUND_VAULT_SEED: &[u8] = b"refund_vault";
pub const POOL_USDC_SEED: &[u8] = b"pool_usdc";
pub const POOL_TOKEN_SEED: &[u8] = b"pool_token";
pub const SALE_VAULT_SEED: &[u8] = b"sale_vault";
pub const FOUNDER_LOCK_SEED: &[u8] = b"founder_lock";
pub const PLATFORM_LOCK_SEED: &[u8] = b"platform_lock";

pub const DECIMALS: u8 = 6;
pub const UNIT: u64 = 1_000_000;

pub const SALE_SUPPLY: u64 = 65_000_000 * UNIT;
pub const LIQUIDITY_SUPPLY: u64 = 13_000_000 * UNIT;
pub const FOUNDER_SUPPLY: u64 = 20_000_000 * UNIT;
pub const PLATFORM_SUPPLY: u64 = 2_000_000 * UNIT;

pub const BPS: u64 = 10_000;
pub const TRADE_FEE_BPS: u16 = 100;
pub const PLATFORM_FEE_BPS: u16 = 30;
pub const STARTUP_FEE_BPS: u16 = 30;
pub const RESERVE_FEE_BPS: u16 = 20;
pub const INFRA_FEE_BPS: u16 = 20;
pub const LISTING_FEE_BPS: u16 = 250;
pub const TREASURY_SHARE_BPS: u16 = 8_000;

pub const CLIFF_MONTHS: u16 = 12;
pub const VEST_MONTHS: u16 = 24;
pub const VERIFICATION_FEE: u64 = 300 * UNIT;
pub const FAUCET_MAX: u64 = 5_000 * UNIT;

pub const TICKER_MIN_LEN: usize = 3;
pub const TICKER_MAX_LEN: usize = 5;
pub const APPLICATION_ID_MAX_LEN: usize = 64;
