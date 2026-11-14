import { Link } from 'wouter'
import { NavLink, PlayIcon, Screen, TopBar } from '../components/ui'
import { useCover } from '../covers'

const BEATS = [
  { name: 'Night bus', meta: '92 BPM · 4 takes' },
  { name: 'Untitled beat 12', meta: '140 BPM · no takes yet' },
  { name: 'Basement tape', meta: '86 BPM · 1 take' },
]

export function Home() {
  const { current } = useCover()
  return (
    <Screen gap={20}>
      <TopBar
        left={<div className="display" style={{ fontSize: 22 }}>Bounce</div>}
        right={<NavLink to="/vault" style={{ fontWeight: 600 }}>Vault</NavLink>}
      />

      <Link
        href="/vocals"
        style={{
          background: 'var(--accent)',
          color: 'var(--bg)',
          textDecoration: 'none',
          borderRadius: 28,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="col" style={{ gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em' }}>FREESTYLE OVER</div>
            <div className="display" style={{ fontSize: 38, letterSpacing: '-0.03em', lineHeight: 1 }}>Night bus</div>
          </div>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              background: 'var(--bg)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            <svg aria-hidden="true" width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="3" width="8" height="13" rx="4" />
              <path d="M5 12a8 8 0 0016 0M13 20v3" />
            </svg>
          </div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.4 }}>92 BPM · F minor · bars 9–24 on loop</div>
        <div className="display" style={{ fontSize: 18, letterSpacing: 0, borderTop: '1px solid var(--bg)', paddingTop: 14 }}>
          One tap and the mic is live
        </div>
      </Link>

      <div className="col">
        <div className="eyebrow" style={{ paddingBottom: 2 }}>Your beats</div>
        {BEATS.map((b, i) => (
          <Link
            key={b.name}
            href="/vocals"
            className={`row between${i < BEATS.length - 1 ? ' divided' : ''}`}
            style={{ minHeight: 56, textDecoration: 'none', color: 'var(--text)' }}
          >
            <span style={{ fontSize: 16, fontWeight: 600 }}>{b.name}</span>
            <span className="small muted">{b.meta}</span>
          </Link>
        ))}
      </div>

      <div className="foot">
        <Link
          href="/player"
          className="row"
          style={{
            minHeight: 60,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: '0 14px',
            marginBottom: 8,
            textDecoration: 'none',
            color: 'var(--text)',
          }}
        >
          <img
            src={current.src}
            alt=""
            style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flex: 'none' }}
          />
          <span className="col" style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Night bus</span>
            <span className="small muted">Mastered · open the player</span>
          </span>
          <PlayIcon size={18} />
        </Link>
        <div className="eyebrow">Add a beat</div>
        <div className="row" style={{ gap: 10 }}>
          <Link href="/capture" className="btn btn-outline" style={{ minHeight: 56 }}>Capture from MPC</Link>
          <Link href="/beat" className="btn btn-outline" style={{ minHeight: 56 }}>Import a file</Link>
        </div>
      </div>
    </Screen>
  )
}
