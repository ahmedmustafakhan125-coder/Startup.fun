import { OBVERSE_PROGRAM_ADDRESS } from './generated/index.ts'

/**
 * The raw event payloads the Obverse program emitted in one transaction, in order.
 * Walks the invoke stack in the logs so a "Program data:" line counts only while our program is
 * the one executing; another program cannot fake an event by logging the same bytes.
 */
export function programEvents(logs: readonly string[], programId: string = OBVERSE_PROGRAM_ADDRESS): Uint8Array[] {
  const stack: string[] = []
  const events: Uint8Array[] = []
  for (const line of logs) {
    const invoke = line.match(/^Program (\S+) invoke \[\d+\]$/)
    if (invoke) stack.push(invoke[1]!)
    else if (/^Program \S+ (success|failed)/.test(line)) stack.pop()
    else if (line.startsWith('Program data: ') && stack[stack.length - 1] === programId)
      events.push(Uint8Array.from(atob(line.slice(14)), c => c.charCodeAt(0)))
  }
  return events
}
