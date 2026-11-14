import { useEffect } from 'react'
import { Redirect, useLocation } from 'wouter'
import { arm, cancel, clock, meterPct, rateLabel, stop, toDb, useCapture } from '../audio/capture'
import { Bars, db, Meter, Screen, type Bar } from '../components/ui'

const BAR_COUNT = 68

export function Record() {
  const cap = useCapture()
  const [, navigate] = useLocation()
  const recording = cap.status === 'recording'

  useEffect(() => {
    arm()
    // Leaving without pressing stop abandons the take.
    return cancel
  }, [])

  if (cap.status === 'idle' || cap.status === 'error' || cap.status === 'opening') return <Redirect to="/capture" />

  const recent = cap.wave.slice(-BAR_COUNT)
  const bars: Bar[] = Array.from({ length: BAR_COUNT }, (_, i) =>
    i < recent.length
      ? { h: Math.round(8 + Math.sqrt(recent[i]) * 104), c: 'var(--text)' }
      : { h: 4, c: 'var(--dim)' },
  )

  const finish = () => {
    const take = stop()
    navigate(take ? '/beat' : '/capture')
  }

  return (
    <Screen gap={28} padBottom={40}>
      <div className="topbar">
        <div className="row" style={{ gap: 10 }}>
          <div
            style={{ width: 10, height: 10, borderRadius: 5, background: recording ? 'var(--rec)' : 'var(--accent)' }}
          />
          <div className="eyebrow" style={{ fontSize: 13, color: recording ? 'var(--rec-text)' : 'var(--accent)' }}>
            {recording ? 'Recording' : 'Armed'}
          </div>
        </div>
        <div className="small muted">{cap.label} · {rateLabel(cap.sampleRate)}</div>
      </div>

      <div className="col" style={{ alignItems: 'center', gap: 6, paddingTop: 24 }}>
        <div className="display" style={{ fontSize: 84, letterSpacing: '-0.03em', lineHeight: 1 }}>
          {clock(cap.elapsed)}
        </div>
        <div className="muted" style={{ fontSize: 14 }}>
          {recording ? 'Started automatically at first sound' : 'Press play on the MPC to start'}
        </div>
      </div>

      <Bars bars={bars} height={120} />

      <div className="card" style={{ padding: '18px 20px', gap: 12 }}>
        <div className="row between">
          <div className="eyebrow">Input level</div>
          <div className="small" style={{ fontWeight: 500, color: cap.clipped ? 'var(--rec-text)' : undefined }}>
            {!recording
              ? 'Waiting for sound'
              : `Peak ${db(toDb(cap.peak), 1)} · ${cap.clipped ? 'clipping' : 'no clipping'}`}
          </div>
        </div>
        <Meter label="L" pct={meterPct(cap.levelL)} height={8} />
        <Meter label="R" pct={meterPct(cap.levelR)} height={8} />
      </div>

      <div className="foot" style={{ alignItems: 'center', gap: 16 }}>
        <button
          type="button"
          onClick={finish}
          aria-label={recording ? 'Stop recording' : 'Cancel'}
          className="stop-btn"
          style={{ width: 96, height: 96 }}
        >
          <i style={{ width: 34, height: 34, borderRadius: 8 }} />
        </button>
        <div className="muted" style={{ fontSize: 14, textAlign: 'center', maxWidth: 280, lineHeight: 1.45 }}>
          Stop when the beat ends. Silence at the start and end gets trimmed for you.
        </div>
      </div>
    </Screen>
  )
}
