import { useState } from 'react'
import { Link } from 'wouter'
import { makeBars, PauseIcon, PlayIcon, Screen } from '../components/ui'
import { useCover } from '../covers'

const DURATION = 161

// Each bar gets its own speed and phase so the visualiser never moves in unison.
const viz = makeBars(5, 34, (i, r) => ({ h: r, c: i % 5 === 0 ? 'var(--text)' : 'var(--accent)' })).map((b) => ({
  c: b.c,
  d: `${(0.45 + b.h * 0.7).toFixed(2)}s`,
  o: `-${(b.h * 0.9).toFixed(2)}s`,
}))

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const pill = { background: 'var(--bg)', color: 'var(--text)' } as const
const skipBtn = {
  width: 52,
  height: 52,
  borderRadius: 26,
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
} as const

export function Player() {
  const { current } = useCover()
  const [playing, setPlaying] = useState(true)
  const [pos, setPos] = useState(72)

  return (
    <Screen gap={0} style={{ paddingLeft: 0, paddingRight: 0, paddingBottom: 0, overflow: 'hidden' }}>
      <img
        src={current.src}
        alt={`Backdrop: ${current.alt}`}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 600, objectFit: 'cover' }}
      />

      <div className="topbar" style={{ padding: '0 16px', position: 'relative' }}>
        <div className="eyebrow" style={{ ...pill, borderRadius: 16, padding: '8px 12px' }}>Mastered · Punchy · −9 LUFS</div>
        <Link
          href="/vault"
          style={{ ...pill, fontSize: 15, fontWeight: 600, minHeight: 44, display: 'flex', alignItems: 'center', borderRadius: 22, padding: '0 16px', textDecoration: 'none' }}
        >
          Vault
        </Link>
      </div>

      <div className="spacer" />

      <div className="viz" aria-hidden="true">
        {viz.map((b, i) => (
          <i
            key={i}
            style={{ background: b.c, animationDuration: b.d, animationDelay: b.o, animationPlayState: playing ? 'running' : 'paused' }}
          />
        ))}
      </div>

      <div
        className="col"
        style={{
          background: 'var(--bg)',
          padding: '20px 24px max(28px, calc(env(safe-area-inset-bottom) + 12px))',
          gap: 14,
          position: 'relative',
        }}
      >
        <div className="row" style={{ gap: 14 }}>
          <Link href="/cover" aria-label="Change cover art" style={{ width: 60, height: 60, borderRadius: 12, overflow: 'hidden', display: 'block', flex: 'none' }}>
            <img src={current.src} alt="" style={{ width: 60, height: 60, objectFit: 'cover', display: 'block' }} />
          </Link>
          <div className="col" style={{ gap: 3, minWidth: 0 }}>
            <h1 className="display" style={{ fontSize: 30, letterSpacing: '-0.03em', lineHeight: 1.05, margin: 0 }}>Night bus</h1>
            <div className="muted" style={{ fontSize: 14 }}>[ARTIST NAME] · Prod. [PRODUCER NAME]</div>
          </div>
        </div>

        <div className="col" style={{ gap: 2 }}>
          <label htmlFor="pl-seek" className="sr-only">Position in track</label>
          <input
            id="pl-seek"
            type="range"
            min={0}
            max={DURATION}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            style={{ width: '100%', height: 28 }}
          />
          <div className="row between small muted">
            <span>{clock(pos)}</span>
            <span>{clock(DURATION)}</span>
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'center', gap: 28 }}>
          <button type="button" aria-label="Previous track" style={skipBtn}>
            <svg aria-hidden="true" width="26" height="26" viewBox="0 0 26 26" fill="currentColor">
              <path d="M22 4v18L9 13z" />
              <rect x="4" y="4" width="3" height="18" rx="1" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => setPlaying(!playing)}
            style={{ ...skipBtn, width: 72, height: 72, borderRadius: 36, background: 'var(--accent)', color: 'var(--bg)' }}
          >
            {playing ? <PauseIcon /> : <PlayIcon size={26} />}
          </button>
          <button type="button" aria-label="Next track" style={skipBtn}>
            <svg aria-hidden="true" width="26" height="26" viewBox="0 0 26 26" fill="currentColor">
              <path d="M4 4v18l13-9z" />
              <rect x="19" y="4" width="3" height="18" rx="1" />
            </svg>
          </button>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <Link href="/snippet" className="btn btn-outline" style={{ borderRadius: 14, minHeight: 48 }}>Snippet</Link>
          <button type="button" className="btn btn-outline" style={{ borderRadius: 14, minHeight: 48 }}>Lyrics</button>
          <button type="button" className="btn btn-outline" style={{ borderRadius: 14, minHeight: 48 }}>Share</button>
        </div>
      </div>
    </Screen>
  )
}
