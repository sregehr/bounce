import { useState } from 'react'
import { Link } from 'wouter'
import { NavLink, PlayIcon, Screen, TopBar } from '../components/ui'

const TAKES = [
  { title: 'Night bus · Take 3', meta: 'Today · 0:48 · Upfront', tag: 'Snippet made' },
  { title: 'Night bus · Take 1', meta: 'Today · 2:41 · Upfront', tag: 'Transcribed' },
  { title: 'Basement tape · Take 1', meta: 'Saturday · 1:12 · Dark', tag: '2 voices' },
  { title: 'Untitled beat 12 · kept', meta: 'Friday · 0:58', tag: 'Saved from the last 60 s' },
]

export function Vault() {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const takes = q ? TAKES.filter((t) => `${t.title} ${t.meta} ${t.tag}`.toLowerCase().includes(q)) : TAKES

  return (
    <Screen gap={16}>
      <TopBar left="Vault" right={<NavLink to="/">Home</NavLink>} />

      <div className="col" style={{ gap: 6 }}>
        <label htmlFor="v-search" className="eyebrow">Search your bars</label>
        <input
          id="v-search"
          type="search"
          className="field"
          placeholder="A word, a beat, a name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="col">
        {takes.map((t) => (
          <div key={t.title} className="row divided" style={{ gap: 14, minHeight: 84 }}>
            <Link href="/player" aria-label={`Play ${t.title}`} className="round-play">
              <PlayIcon />
            </Link>
            <div className="col" style={{ flex: 1, gap: 3, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{t.title}</div>
              <div className="small muted">{t.meta}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{t.tag}</div>
            </div>
          </div>
        ))}
        {takes.length === 0 && <div className="note" style={{ padding: '20px 0' }}>Nothing in the vault matches “{query}”.</div>}
      </div>

      <div className="foot" style={{ gap: 12 }}>
        <div className="note">
          Every take is transcribed on the phone, so search finds words inside a freestyle and jumps to the line.
        </div>
        <button type="button" className="btn btn-outline" style={{ flex: 'none' }}>Send stems to an engineer</button>
      </div>
    </Screen>
  )
}
