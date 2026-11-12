// Turns a failed transaction into the plain message the UI already uses for that case.
import {
  getObverseErrorMessage,
  OBVERSE_ERROR__COMMIT_TOO_SMALL,
  OBVERSE_ERROR__FAUCET_DISABLED,
  OBVERSE_ERROR__HEARTBEAT_RED,
  OBVERSE_ERROR__INSUFFICIENT_BALANCE,
  OBVERSE_ERROR__NOT_FOUNDER,
  OBVERSE_ERROR__NOT_LIVE,
  OBVERSE_ERROR__NOT_WOUND_DOWN,
  OBVERSE_ERROR__NOTHING_TO_CLAIM,
  OBVERSE_ERROR__PAUSED,
  OBVERSE_ERROR__RAISE_CLOSED,
  OBVERSE_ERROR__SLIPPAGE_EXCEEDED,
  OBVERSE_ERROR__TRADE_TOO_SMALL,
  type ObverseError,
} from '../../../sdk/src/index.ts'
import { UserError } from './client'

/** What the user was doing, for errors whose wording depends on it. */
export type Action = 'usdc' | 'sell' | 'claim' | 'refund'

const MESSAGES: Record<number, string | ((action: Action) => string)> = {
  [OBVERSE_ERROR__RAISE_CLOSED]: 'This raise is closed.',
  [OBVERSE_ERROR__NOT_LIVE]: 'Trading is not open for this startup.',
  [OBVERSE_ERROR__NOT_WOUND_DOWN]: 'Nothing to refund here.',
  [OBVERSE_ERROR__INSUFFICIENT_BALANCE]: action =>
    action === 'usdc' ? 'Not enough USDC. Use the faucet in Portfolio.' : 'You do not hold that many tokens.',
  [OBVERSE_ERROR__HEARTBEAT_RED]: 'Payouts are paused while the heartbeat is red.',
  [OBVERSE_ERROR__NOTHING_TO_CLAIM]: 'Nothing to claim under this month’s cap.',
  [OBVERSE_ERROR__NOT_FOUNDER]: 'Only the founder’s wallet can claim this.',
  [OBVERSE_ERROR__SLIPPAGE_EXCEEDED]: 'The price moved while you were confirming. Check the new quote and try again.',
  [OBVERSE_ERROR__COMMIT_TOO_SMALL]: 'Enter a larger amount.',
  [OBVERSE_ERROR__TRADE_TOO_SMALL]: 'Enter a larger amount.',
  [OBVERSE_ERROR__PAUSED]: 'The platform is paused for now. Selling and refunds still work.',
  [OBVERSE_ERROR__FAUCET_DISABLED]: 'The demo USDC faucet is switched off.',
}

/** Everything an error carries, as one searchable string. RPC errors nest their detail. */
function flatten(error: unknown): string {
  const seen = new Set<unknown>()
  const json = JSON.stringify(error, (_key, value) => {
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Error) {
      if (seen.has(value)) return undefined
      seen.add(value)
      return { ...value, message: value.message, cause: (value as { cause?: unknown }).cause }
    }
    return value
  })
  return `${error instanceof Error ? error.message : ''} ${json ?? ''}`
}

export function explain(error: unknown, action: Action): string {
  if (error instanceof UserError) return error.message
  const text = flatten(error)
  const found =
    text.match(/Error Number: (\d+)/) ?? text.match(/"Custom\\?":\s*\\?"?(\d+)/) ?? text.match(/custom program error: (0x[0-9a-f]+)/i)
  if (found) {
    const code = Number(found[1])
    const message = MESSAGES[code]
    if (message) return typeof message === 'function' ? message(action) : message
    if (code >= 6000) return getObverseErrorMessage(code as ObverseError)
  }
  if (/reject|denied|declin|cancel/i.test(text)) return 'You declined the request in your wallet.'
  if (/insufficient (funds|lamports)|no record of a prior credit|AccountNotFound/i.test(text))
    return 'Your wallet needs a little devnet SOL to pay the network fee. Get some at faucet.solana.com.'
  if (/429|Too Many Requests/i.test(text)) return 'The devnet endpoint is busy. Wait a few seconds and try again.'
  return 'The transaction failed. Nothing was moved.'
}
