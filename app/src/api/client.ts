// Typed HTTP client for the backend (live mode only). Pages never call this; store actions do.
import { signMessageWithWallet } from '../chain/client'
import type { Application, Check, Checks, Startup } from '../store/types'

const BASE = import.meta.env.VITE_API_URL || '/api'

/** A refusal from the server. `message` is already written for the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

// The connected wallet, so a call that finds the session expired can sign in again.
let wallet: string | null = null
export const setApiWallet = (address: string | null) => {
  wallet = address
}

async function request<T>(method: string, path: string, body?: unknown, interactive = true): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Offline', 'The Obverse server did not answer. Try again in a moment.')
  }
  if (res.status === 401 && interactive && wallet && path !== '/auth/verify') {
    await signIn(wallet)
    return request(method, path, body, false)
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Error', data.message ?? 'The server could not do that.')
  return data as T
}

/** Proves control of the wallet by signing a one-time message; the server answers with a session cookie. */
export async function signIn(address: string): Promise<{ address: string; admin: boolean }> {
  const { message } = await request<{ message: string }>('POST', '/auth/nonce', { address }, false)
  const signature = await signMessageWithWallet(address, new TextEncoder().encode(message))
  return request('POST', '/auth/verify', { address, signature: btoa(String.fromCharCode(...signature)) }, false)
}

/** An application as the server sends it: the app's shape plus the owner wallet and the DNS record. */
export type ServerApplication = Omit<Application, 'mine'> & { wallet: string; code: string }
/** A listed startup's off-chain profile. */
export type Profile = Pick<Startup, 'id' | 'name' | 'ticker' | 'tagline' | 'about' | 'category' | 'country' | 'website' | 'github' | 'social' | 'founders' | 'listedAt'> & { checks: Checks }
export type FormFields = Pick<Application, 'founderName' | 'founderRole' | 'country' | 'email' | 'name' | 'ticker' | 'tagline' | 'about' | 'category' | 'website' | 'github' | 'social' | 'raiseTarget' | 'monthlyBudget' | 'feeCap'>

const admin = (id: string, action: string, body?: unknown) => request<ServerApplication>('POST', `/admin/applications/${id}/${action}`, body)

export const api = {
  /** Null when there is no session; never opens the wallet. */
  logout: () => request<unknown>('POST', '/auth/logout', undefined, false).catch(() => null),
  me: () => request<{ address: string; admin: boolean }>('GET', '/me', undefined, false).catch(() => null),
  startups: () => request<Profile[]>('GET', '/startups', undefined, false),
  saveDraft: (form: Partial<FormFields>) => request<ServerApplication>('PUT', '/applications/draft', form),
  verify: (id: string, check: string) => request<{ check?: Check; redirect?: string }>('POST', `/applications/${id}/verify/${check}`),
  submit: (form: FormFields & { id: string; feeSignature: string }) => request<ServerApplication>('POST', '/applications', form),
  mine: () => request<ServerApplication[]>('GET', '/applications/mine', undefined, false),
  adminApplications: () => request<ServerApplication[]>('GET', '/admin/applications', undefined, false),
  runChecks: (id: string) => admin(id, 'run-checks'),
  schedule: (id: string, when: number) => admin(id, 'schedule', { when }),
  reject: (id: string, reason: string) => admin(id, 'reject', { reason }),
  listNow: (id: string) => admin(id, 'list-now'),
  closeRaise: (id: string) => request<{ signature: string }>('POST', `/admin/startups/${id}/close-raise`),
  /** Where the browser goes for a server-side redirect, such as GitHub sign-in. */
  url: (path: string) => BASE + path,
}
