// The lock on /admin. It keeps the page out of sight; it is not what protects admin actions.
// In live mode the server still refuses every admin call from a wallet that is not in ADMIN_WALLETS.
import { create } from 'zustand'

// The password is never stored. This is SHA-256 of it, salted and repeated ROUNDS times, so the
// bundle does not give the password away and guessing it is slow. To change the password, run:
//   node -e "const c=require('crypto');let h=c.createHash('sha256').update('obverse-admin:'+process.argv[1]).digest();for(let i=0;i<50000;i++)h=c.createHash('sha256').update(h).digest();console.log(h.toString('hex'))" 'new password'
const SALT = 'obverse-admin:'
const ROUNDS = 50_000
const PASSWORD_HASH = '2dfb2b2b99025797c78e2bb83b00a9ca441645eb57bbb622c9651a057bae4e38'
const KEY = 'obverse-admin-unlocked'

// Plain SHA-256. The browser's own (crypto.subtle) is missing on pages served over http, so it cannot be relied on.
const primes = (count: number) => {
  const out: number[] = []
  for (let n = 2; out.length < count; n++) if (out.every(p => n % p)) out.push(n)
  return out
}
const frac = (x: number) => ((x % 1) * 2 ** 32) >>> 0
const K = Uint32Array.from(primes(64), p => frac(Math.cbrt(p)))
const H0 = Uint32Array.from(primes(8), p => frac(Math.sqrt(p)))
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

export function sha256(message: Uint8Array): Uint8Array {
  const h = H0.slice()
  const padded = new Uint8Array((((message.length + 9 + 63) >> 6) << 6) >>> 0)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 4, message.length * 8)
  const w = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const [x, y] = [w[i - 15], w[i - 2]]
      w[i] = w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10))
    }
    let [a, b, c, d, e, f, g, last] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (last + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      ;[last, g, f, e, d, c, b, a] = [g, f, e, (d + t1) | 0, c, b, a, (t1 + t2) | 0]
    }
    ;[a, b, c, d, e, f, g, last].forEach((v, i) => (h[i] += v))
  }
  const out = new Uint8Array(32)
  h.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v))
  return out
}

export function passwordHash(password: string): string {
  let digest = sha256(new TextEncoder().encode(SALT + password))
  for (let i = 0; i < ROUNDS; i++) digest = sha256(digest)
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
}

// Session storage: the page stays unlocked across reloads, and locks again when the tab closes.
const remembered = () => {
  try {
    return window.sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
const remember = (unlocked: boolean) => {
  try {
    if (unlocked) window.sessionStorage.setItem(KEY, '1')
    else window.sessionStorage.removeItem(KEY)
  } catch {
    // Storage is blocked: the page just asks again after a reload.
  }
}

interface Gate {
  unlocked: boolean
  /** True when the password is right. */
  unlock: (password: string) => boolean
  lock: () => void
}
export const useAdminGate = create<Gate>(set => ({
  unlocked: remembered(),
  unlock: password => {
    const ok = passwordHash(password) === PASSWORD_HASH
    if (ok) {
      remember(true)
      set({ unlocked: true })
    }
    return ok
  },
  lock: () => {
    remember(false)
    set({ unlocked: false })
  },
}))
