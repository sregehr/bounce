import { useState } from 'react'
import { Link } from 'wouter'
import { NavLink, Screen, Segmented } from '../components/ui'

const LENGTHS = ['8 bars', '16 bars', 'Whole beat'] as const

// 16-bar loop: bars already recorded, the current pass, the playhead, and what is left.
const strip = Array.from({ length: 16 }, (_, i) =>
  i < 8 ? 'var(--text)' : i < 10 ? 'var(--accent)' : i === 10 ? 'var(--rec)' : 'var(--dim)',
)

export function Vocals() {
  const [len, setLen] = useState<(typeof LENGTHS)[number]>('16 bars')
  const [punchIn, setPunchIn] = useState(true)
  return (
    <Screen gap={14}>
      <div className="topbar" style={{ minHeight: 48 }}>
        <div className="col" style={{ gap: 2 }}>
          <h1 className="display" style={{ fontSize: 24, margin: 0 }}>Night bus</h1>
          <div className="small muted">92 BPM · F minor</div>
        </div>
        <NavLink to="/">Back</NavLink>
      </div>

      <div className="card" style={{ padding: 16, gap: 12 }}>
        <div className="row between">
          <div className="eyebrow">Loop · bars 9–24</div>
          <div className="small" style={{ fontWeight: 600, color: 'var(--accent)' }}>Bar 19 · pass 2</div>
        </div>
        <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(16, minmax(0, 1fr))', gap: 3 }}>
          {strip.map((c, i) => (
            <div key={i} style={{ height: 34, borderRadius: 4, background: c }} />
          ))}
        </div>
        <Segmented options={LENGTHS} value={len} onChange={setLen} variant="inset" />
      </div>

      <label className="row divided" style={{ gap: 14, minHeight: 56 }}>
        <span className="col" style={{ flex: 1, gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Punch in at bar 17</span>
          <span className="small muted">Keeps bars 9–16 from pass 1</span>
        </span>
        <input type="checkbox" checked={punchIn} onChange={(e) => setPunchIn(e.target.checked)} />
      </label>

      <div className="row divided" style={{ minHeight: 56 }}>
        <div className="col" style={{ flex: 1, gap: 2 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Always listening</div>
          <div className="small muted">Missed the record button? The last 60 s are held.</div>
        </div>
        <button type="button" className="chip" style={{ padding: '0 16px', borderColor: 'var(--text)', flex: 'none' }}>
          Keep that
        </button>
      </div>

      <div className="note">
        Beat on Car Audio. Bluetooth lag measured at 180 ms and corrected. The beat is removed from the mic after the take.
      </div>

      <div className="foot" style={{ alignItems: 'center', gap: 14 }}>
        <button
          type="button"
          aria-label="Stop recording"
          className="stop-btn rec-halo"
          style={{ width: 132, height: 132, borderWidth: 4 }}
        >
          <i style={{ width: 46, height: 46, borderRadius: 10 }} />
        </button>
        <Link href="/playback" className="btn btn-primary" style={{ alignSelf: 'stretch' }}>
          Done, hear it back
        </Link>
      </div>
    </Screen>
  )
}
