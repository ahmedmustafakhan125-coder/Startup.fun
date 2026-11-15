import { useId } from 'react'

/** The Startup.fun mark: a two-tone capsule with a white sticker outline. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  // Several logos can be on one page, and clip paths are looked up by id.
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="9 9 82 82" className={className} style={{ flex: 'none' }} aria-hidden="true">
      <defs>
        <clipPath id={`${id}-pill`}>
          <rect x="-17.5" y="-42" width="35" height="84" rx="17.5" />
        </clipPath>
        <clipPath id={`${id}-top`}>
          <rect x="-25" y="-50" width="50" height="50" />
        </clipPath>
      </defs>
      <g transform="translate(50 50) rotate(45)">
        <rect x="-22.5" y="-47" width="45" height="94" rx="22.5" fill="#fff" />
        <g clipPath={`url(#${id}-pill)`}>
          <rect x="-20" y="0" width="40" height="44" fill="#8bb120" />
          <rect x="-21" y="-45.5" width="35" height="84" rx="17.5" fill="#aedc24" />
          <rect x="-20" y="-44" width="40" height="44" fill="#b4c8cc" />
          <g clipPath={`url(#${id}-top)`}>
            <rect x="-21.2" y="-40.8" width="35" height="84" rx="17.5" fill="#121c61" />
          </g>
          <rect x="-20" y="-2.2" width="40" height="4.4" fill="#fff" />
        </g>
        <path d="M-11.3 22.5a11.5 11.5 0 0 0 6.2 11" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeDasharray="0.1 3.6 5.4 3.6 2 9" />
      </g>
    </svg>
  )
}
