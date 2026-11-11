import type { CSSProperties, ReactNode } from 'react'
import { Icon, cx } from './ui'

interface Props {
  label: string
  size?: number
  face?: 'front' | 'back'
  rotation?: number // degrees; overrides face
  hover?: boolean // flip when hovered (or when a .coin-host parent is hovered)
  tone?: 'lime' | 'dim'
  thick?: boolean
  spin?: boolean
  land?: boolean
  front?: ReactNode
  back?: ReactNode
  className?: string
}

// A two-sided token. Front carries the ticker, back carries the heartbeat.
export function Coin({ label, size = 48, face = 'front', rotation, hover, tone = 'lime', thick, spin, land, front, back, className }: Props) {
  const t = thick ? Math.max(4, Math.round(size * 0.07)) : 0
  const layers = thick ? 7 : 0
  const rot = rotation ?? (face === 'back' ? 180 : 0)
  const style = { '--s': size + 'px', '--t': t + 'px', '--rot': rot + 'deg' } as CSSProperties
  return (
    <div className={cx('coin', hover && 'coin-hover', spin && 'coin-spin', land && 'coin-land', className)} data-tone={tone} style={style}>
      <div className="coin-inner">
        {Array.from({ length: layers }, (_, i) => (
          <div key={i} className="coin-edge" style={{ transform: `translateZ(${t / 2 - ((i + 0.5) * t) / layers}px)` }} />
        ))}
        <div className="coin-face coin-front">{front ?? label.slice(0, size < 40 ? 2 : 4)}</div>
        <div className="coin-face coin-back">{back ?? <Icon name="pulse" size={size * 0.5} />}</div>
      </div>
    </div>
  )
}
