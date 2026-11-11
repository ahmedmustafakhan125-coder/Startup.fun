import { ago } from '../lib/format'
import type { CheckKey, Checks } from '../store/types'
import { CheckMark, Icon } from './ui'

export const CHECK_META: Record<CheckKey, { title: string; icon: string }> = {
  kyc: { title: 'Founder identity', icon: 'shield' },
  domain: { title: 'Domain ownership', icon: 'globe' },
  github: { title: 'Code repository', icon: 'code' },
  socials: { title: 'Social accounts', icon: 'at' },
  founder: { title: 'Founder details', icon: 'user' },
}
export const CHECK_ORDER: CheckKey[] = ['kyc', 'domain', 'github', 'socials', 'founder']

export function Checklist({ checks }: { checks: Checks }) {
  return (
    <ul className="m-0 list-none p-0">
      {CHECK_ORDER.map(k => {
        const c = checks[k]
        return (
          <li key={k} className="flex items-start gap-3.5 border-t border-white/[.06] py-3.5 first:border-t-0 first:pt-0 last:pb-0">
            <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full bg-white/[.06] text-ink2">
              <Icon name={CHECK_META[k].icon} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{CHECK_META[k].title}</div>
              <div className="text-[15px] text-ink2">{c.detail}</div>
              <div className="text-sm text-ink3">{c.checkedAt ? 'Checked ' + ago(c.checkedAt) : 'Not checked yet'}</div>
            </div>
            <CheckMark status={c.status} />
          </li>
        )
      })}
    </ul>
  )
}

export function CheckDots({ checks }: { checks: Checks }) {
  return (
    <span className="inline-flex gap-1.5" aria-label={CHECK_ORDER.map(k => `${CHECK_META[k].title} ${checks[k].status}`).join(', ')}>
      {CHECK_ORDER.map(k => (
        <span key={k} title={`${CHECK_META[k].title}: ${checks[k].status}`}>
          <CheckMark status={checks[k].status} size={20} />
        </span>
      ))}
    </span>
  )
}

export function Beats({ beats }: { beats: number[] }) {
  return (
    <div className="flex items-end gap-[3px]" role="img" aria-label={`Last ${beats.length} heartbeats: ${beats.filter(Boolean).length} passed`}>
      {beats.map((b, i) => (
        <span key={i} className="w-[7px] rounded-[2px]" style={{ height: b ? 22 : 9, background: b ? '#d4ff24' : '#ff6b5e', opacity: 0.35 + (i / beats.length) * 0.65 }} />
      ))}
    </div>
  )
}
