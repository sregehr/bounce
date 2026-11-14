import { useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'
import { clock, rateLabel, useCapture } from '../audio/capture'
import { Bars, db, makeBars, NavLink, PauseIcon, PlayIcon, Screen, TopBar } from '../components/ui'

const bars = makeBars(7, 59, (i, r) => {
  const env = 0.4 + 0.6 * Math.abs(Math.sin(i * 0.31 + 1))
  return { h: Math.round(8 + r * env * 72) }
})

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="col" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', gap: 4 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 20 }}>{value}</div>
    </div>
  )
}

export function BeatReady() {
  const [name, setName] = useState('Untitled beat 13')
  const { take } = useCapture()
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => setPlaying(false), [take])

  const toggle = () => {
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }
  const shown = take ? take.wave.map((p) => ({ h: Math.round(8 + Math.sqrt(p) * 72) })) : bars
  const fileName = `${name.trim() || 'beat'}.wav`
  return (
    <Screen gap={22} padBottom={32}>
      <TopBar left={<div className="eyebrow">Beat captured</div>} right={<NavLink to="/record">Record again</NavLink>} />

      <div className="col" style={{ gap: 6 }}>
        <label htmlFor="take-name" className="muted" style={{ fontSize: 12 }}>Name</label>
        <input
          id="take-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="display"
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--border)',
            borderRadius: 0,
            color: 'var(--text)',
            fontSize: 30,
            padding: '4px 0 10px',
            width: '100%',
          }}
        />
      </div>

      <div className="card" style={{ padding: '18px 16px' }}>
        <Bars
          bars={shown}
          height={84}
          style={{
            borderLeft: '3px solid var(--accent)',
            borderRight: '3px solid var(--accent)',
            borderRadius: 4,
            padding: '0 6px',
          }}
        />
        <div className="row" style={{ gap: 14 }}>
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            className="round-play"
            style={{ width: 48, height: 48 }}
            onClick={toggle}
          >
            {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>
          {take ? (
            <div className="col" style={{ gap: 2 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>
                {clock(take.duration)} · {rateLabel(take.sampleRate)} · 24-bit WAV
              </div>
              <div className="small muted">
                Trimmed {take.trimmed.toFixed(1)} s of silence.{' '}
                <a href={take.url} download={fileName} style={{ color: 'var(--accent)' }}>Save the file</a>
              </div>
            </div>
          ) : (
            <div className="col" style={{ gap: 2 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>2:41 · 92 BPM · F minor</div>
              <div className="small muted">Trimmed 0.8 s of silence. Drag the edges to adjust.</div>
            </div>
          )}
        </div>
        {take && (
          <audio
            ref={audio}
            src={take.url}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        )}
      </div>

      {take ? (
        <div className="row">
          <Stat label={take.clipped ? 'Peak · clipped' : 'Peak'} value={db(take.peakDb, 1)} />
          <Stat label="Average level" value={db(take.rmsDb, 1)} />
        </div>
      ) : (
        <div className="row">
          <Stat label="Peak" value="−3.2 dB" />
          <Stat label="Loudness" value="−19 LUFS" />
        </div>
      )}

      <div className="foot" style={{ gap: 12 }}>
        <div className="display" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>What next?</div>
        <Link
          href="/vocals"
          className="col"
          style={{ background: 'var(--accent)', color: 'var(--bg)', textDecoration: 'none', borderRadius: 18, padding: '18px 20px', gap: 4 }}
        >
          <div className="display" style={{ fontSize: 19, letterSpacing: 0 }}>Freestyle over it</div>
          <div style={{ fontSize: 14, lineHeight: 1.4 }}>Loop a section and rap. Polished playback in seconds.</div>
        </Link>
        <Link
          href="/master"
          className="col"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            textDecoration: 'none',
            borderRadius: 18,
            padding: '18px 20px',
            gap: 4,
          }}
        >
          <div className="display" style={{ fontSize: 19, letterSpacing: 0 }}>Master the beat</div>
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.4 }}>Instrumental only. Pick a style and export.</div>
        </Link>
      </div>
    </Screen>
  )
}
