import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StartupRow } from '../components/StartupRow'
import { Empty, Icon, PageHead } from '../components/ui'
import { CATEGORIES } from '../config'
import { change24h, mcapOf } from '../lib/curve'
import { useStore } from '../store/useStore'
import type { Startup } from '../store/types'

const filters: { key: string; label: string; test: (s: Startup) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'live', label: 'Trading', test: s => s.phase === 'live' && s.heartbeat === 'green' },
  { key: 'raising', label: 'Raising', test: s => s.phase === 'raising' },
  { key: 'silent', label: 'Silent', test: s => s.phase === 'live' && s.heartbeat === 'red' },
  { key: 'wound', label: 'Wound down', test: s => s.phase === 'wound_down' },
]
const sorts: Record<string, { label: string; fn: (a: Startup, b: Startup) => number }> = {
  volume: { label: '24h volume', fn: (a, b) => b.volume24h - a.volume24h },
  mcap: { label: 'Market cap', fn: (a, b) => mcapOf(b) - mcapOf(a) },
  change: { label: '24h change', fn: (a, b) => change24h(b) - change24h(a) },
  newest: { label: 'Newest', fn: (a, b) => b.listedAt - a.listedAt },
}

export default function Explore() {
  const startups = useStore(s => s.startups)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [cat, setCat] = useState('All categories')
  const [sort, setSort] = useState('volume')

  const rows = useMemo(() => {
    const f = filters.find(x => x.key === filter)!
    const needle = q.trim().toLowerCase()
    return startups
      .filter(f.test)
      .filter(s => cat === 'All categories' || s.category === cat)
      .filter(s => !needle || (s.name + ' ' + s.ticker + ' ' + s.tagline + ' ' + s.country).toLowerCase().includes(needle))
      .sort(sorts[sort].fn)
  }, [startups, q, filter, cat, sort])

  return (
    <div>
      <PageHead
        title="Explore startups"
        lead="Every listing passed identity, domain, code and social checks, and those checks keep re-running. The badge shows the latest result."
        right={
          <Link to="/list" className="btn btn-glass">
            List your startup
          </Link>
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_200px_180px]">
        <label className="relative block">
          <span className="sr-only">Search startups</span>
          <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-ink3" />
          <input className="input !pl-11" placeholder="Search by name, ticker or country" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <select className="input" value={cat} onChange={e => setCat(e.target.value)} aria-label="Category">
          {['All categories', ...CATEGORIES].map(c => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="input" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort by">
          {Object.entries(sorts).map(([k, v]) => (
            <option key={k} value={k}>
              Sort: {v.label}
            </option>
          ))}
        </select>
      </div>
      <div className="scroll-x -mx-4 mb-5 flex gap-2 px-4 sm:mx-0 sm:px-0">
        {filters.map(f => (
          <button key={f.key} className="chip" data-on={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
            <span className="text-ink3">{startups.filter(f.test).length}</span>
          </button>
        ))}
      </div>
      {rows.length ? (
        <div className="glass overflow-hidden">
          {rows.map(s => (
            <StartupRow key={s.id} s={s} />
          ))}
        </div>
      ) : (
        <Empty
          title="No startups match"
          body="Clear the search or pick another filter to see the full list."
          action={
            <button
              className="btn btn-glass"
              onClick={() => {
                setQ('')
                setFilter('all')
                setCat('All categories')
              }}
            >
              Clear filters
            </button>
          }
        />
      )}
    </div>
  )
}
