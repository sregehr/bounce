import { Link } from 'wouter'
import { Bars, makeBars, Meter, Screen } from '../components/ui'

const bars = makeBars(7, 68, (i, r) => {
  const env = 0.4 + 0.6 * Math.abs(Math.sin(i * 0.31 + 1))
  const live = i < 46
  return { h: live ? Math.round(8 + r * env * 104) : 4, c: live ? 'var(--text)' : 'var(--dim)' }
})

export function Record() {
  return (
    <Screen gap={28} padBottom={40}>
      <div className="topbar">
        <div className="row" style={{ gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--rec)' }} />
          <div className="eyebrow" style={{ fontSize: 13, color: 'var(--rec-text)' }}>Recording</div>
        </div>
        <div className="small muted">MPC Sample · 48 kHz</div>
      </div>

      <div className="col" style={{ alignItems: 'center', gap: 6, paddingTop: 24 }}>
        <div className="display" style={{ fontSize: 84, letterSpacing: '-0.03em', lineHeight: 1 }}>1:47</div>
        <div className="muted" style={{ fontSize: 14 }}>Started automatically at first sound</div>
      </div>

      <Bars bars={bars} height={120} />

      <div className="card" style={{ padding: '18px 20px', gap: 12 }}>
        <div className="row between">
          <div className="eyebrow">Input level</div>
          <div className="small" style={{ fontWeight: 500 }}>Peak −3.2 dB · no clipping</div>
        </div>
        <Meter label="L" pct={74} height={8} />
        <Meter label="R" pct={69} height={8} />
      </div>

      <div className="foot" style={{ alignItems: 'center', gap: 16 }}>
        <Link href="/beat" aria-label="Stop recording" className="stop-btn" style={{ width: 96, height: 96 }}>
          <i style={{ width: 34, height: 34, borderRadius: 8 }} />
        </Link>
        <div className="muted" style={{ fontSize: 14, textAlign: 'center', maxWidth: 280, lineHeight: 1.45 }}>
          Stop when the beat ends. Silence at the start and end gets trimmed for you.
        </div>
      </div>
    </Screen>
  )
}
