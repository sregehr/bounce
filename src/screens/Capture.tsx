import { Link } from 'wouter'
import { Meter, NavLink, Screen, TopBar } from '../components/ui'

export function Capture() {
  return (
    <Screen gap={24} padBottom={32}>
      <TopBar left="Capture a beat" right={<NavLink to="/">Back</NavLink>} />

      <div className="card">
        <div className="row" style={{ gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }} />
          <div className="eyebrow accent">Connected via USB-C</div>
        </div>
        <div className="display" style={{ fontSize: 30 }}>MPC Sample</div>
        <div className="muted" style={{ fontSize: 14 }}>48 kHz · 24-bit · stereo</div>
        <div className="col" style={{ gap: 6 }}>
          <Meter label="L" pct={62} />
          <Meter label="R" pct={57} />
        </div>
      </div>

      <div className="col" style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <Link
          href="/record"
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
          }}
        >
          Arm
        </Link>
        <div className="muted" style={{ fontSize: 15, lineHeight: 1.45, textAlign: 'center', maxWidth: 260 }}>
          Arm, then press play on the MPC. Recording starts when the beat does.
        </div>
      </div>

      <div className="note" style={{ textAlign: 'center' }}>
        Tempo and key are detected after capture, so the beat is ready to loop.
      </div>
    </Screen>
  )
}
