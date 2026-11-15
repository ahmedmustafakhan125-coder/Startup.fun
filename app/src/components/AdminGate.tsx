import { useState, type FormEvent, type ReactNode } from 'react'
import { useAdminGate } from '../lib/adminGate'
import { Icon } from './ui'

/** Shows its children only after the admin password has been entered in this tab. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { unlocked, unlock } = useAdminGate()
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState(false)
  const [checking, setChecking] = useState(false)
  if (unlocked) return <>{children}</>

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!password || checking) return
    setChecking(true)
    // Checking takes a moment on purpose. The pause lets the button show it first, and slows guessing.
    setTimeout(() => {
      const ok = unlock(password)
      setChecking(false)
      setWrong(!ok)
      if (!ok) setPassword('')
    }, 400)
  }

  return (
    <form onSubmit={submit} className="glass mx-auto mt-10 max-w-[420px] p-6 sm:p-8">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-white/[.07] text-lime">
        <Icon name="lock" size={22} />
      </span>
      <h1 className="mt-5 text-[30px]">Admin</h1>
      <p className="mt-2 text-ink2">This page is locked. Enter the admin password to open it.</p>
      <label className="label mt-6" htmlFor="admin-password">
        Password
      </label>
      <input
        id="admin-password"
        type="password"
        className="input"
        autoFocus
        autoComplete="current-password"
        value={password}
        aria-invalid={wrong}
        aria-describedby={wrong ? 'admin-password-error' : undefined}
        onChange={e => {
          setPassword(e.target.value)
          setWrong(false)
        }}
      />
      {wrong && (
        <p id="admin-password-error" className="mb-0 mt-2 text-sm text-red" role="alert">
          That password is not right. Try again.
        </p>
      )}
      <button className="btn btn-lime mt-5 w-full" disabled={!password || checking}>
        {checking ? 'Checking' : 'Unlock'}
      </button>
    </form>
  )
}
