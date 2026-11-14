import { useEffect } from 'react'
import { Link } from 'wouter'
import { close, meterPct, open, openIfAllowed, pairLabel, rateLabel, useCapture, wake } from '../audio/capture'
import { Meter, NavLink, Screen, TopBar } from '../components/ui'

export function Capture() {
  const cap = useCapture()
  const live = cap.status === 'ready' || cap.status === 'armed' || cap.status === 'recording'

  useEffect(() => {
    void openIfAllowed()
  }, [])

  return (
    <Screen gap={24} padBottom={32}>
      <TopBar
        left="Capture a beat"
        right={
          <span onClick={close}>
            <NavLink to="/">Back</NavLink>
          </span>
        }
      />

      <div className="card">
        <div className="row" style={{ gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: live ? 'var(--accent)' : 'var(--dim)' }} />
          <div className={`eyebrow${live ? ' accent' : ''}`}>
            {live ? 'Connected' : cap.status === 'opening' ? 'Connecting' : 'Not connected'}
          </div>
        </div>

        {live ? (
          <>
            <div className="display" style={{ fontSize: 30 }}>{cap.label}</div>
            <div className="muted" style={{ fontSize: 14 }}>
              {rateLabel(cap.sampleRate)} · {pairLabel(cap)}
            </div>
            <div className="col" style={{ gap: 6 }}>
              <Meter label="L" pct={meterPct(cap.levelL)} />
              <Meter label="R" pct={meterPct(cap.levelR)} />
            </div>
            {cap.inputs.length > 1 && (
              <label className="col" style={{ gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Input</span>
                <select
                  className="field"
                  value={cap.deviceId ?? ''}
                  onChange={(e) => void open(e.target.value)}
                  style={{ background: 'var(--bg)' }}
                >
                  {cap.inputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <>
            <div className="display" style={{ fontSize: 30 }}>Plug in the MPC</div>
            <div className="muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
              {cap.error ?? 'Connect it by USB-C, then allow audio input when the browser asks.'}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={cap.status === 'opening'}
              onClick={() => void open()}
            >
              {cap.status === 'opening' ? 'Connecting…' : cap.error ? 'Try again' : 'Connect'}
            </button>
          </>
        )}
      </div>

      <div className="col" style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <Link
          href="/record"
          onClick={(e) => {
            if (!live) e.preventDefault()
            else wake()
          }}
          aria-disabled={!live}
          className="display rec-halo"
          style={{
            width: 148,
            height: 148,
            borderRadius: 74,
            background: 'var(--rec)',
            color: 'var(--bg)',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            letterSpacing: 0,
            opacity: live ? 1 : 0.35,
          }}
        >
          Arm
        </Link>
        <div className="muted" style={{ fontSize: 15, lineHeight: 1.45, textAlign: 'center', maxWidth: 260 }}>
          Arm, then press play on the MPC. Recording starts when the beat does.
        </div>
      </div>

      <div className="note" style={{ textAlign: 'center' }}>
        Silence at the start and end is trimmed after capture.
      </div>
    </Screen>
  )
}
