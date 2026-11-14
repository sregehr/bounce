import { useState } from 'react'
import { Bars, makeBars, NavLink, Screen, Segmented, TopBar } from '../components/ui'

const LENGTHS = ['15 s', '20 s', '30 s'] as const
// The strongest stretch starts at 0:22; its end follows the chosen length.
const RANGE = { '15 s': '0:22 – 0:37', '20 s': '0:22 – 0:42', '30 s': '0:22 – 0:52' } as const

const bars = makeBars(11, 59, (i, r) => {
  const phrase = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.42))
  return { h: Math.round(8 + r * phrase * 84) }
})

export function Snippet() {
  const [len, setLen] = useState<(typeof LENGTHS)[number]>('20 s')
  const [captions, setCaptions] = useState(true)
  const [credit, setCredit] = useState(true)

  return (
    <Screen>
      <TopBar left="Snippet" right={<NavLink to="/playback">Back</NavLink>} />

      <div
        className="col"
        style={{
          alignSelf: 'stretch',
          height: 356,
          flex: 'none',
          borderRadius: 24,
          background: 'var(--accent)',
          color: 'var(--bg)',
          padding: '24px 22px',
          justifyContent: 'space-between',
        }}
      >
        <div className="col" style={{ gap: 4 }}>
          <div className="display" style={{ fontSize: 48, letterSpacing: '-0.03em', lineHeight: 1 }}>Night bus</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>[ARTIST NAME]</div>
        </div>
        <Bars bars={bars} height={96} color="var(--bg)" />
        <div className="col" style={{ gap: 8, minHeight: 52, justifyContent: 'flex-end' }}>
          {captions && (
            <div className="display" style={{ fontSize: 22, lineHeight: 1.2, letterSpacing: 0 }}>[CAPTION LINE FROM THE TAKE]</div>
          )}
          {credit && <div className="small" style={{ fontWeight: 600, letterSpacing: '0.06em' }}>PROD. [PRODUCER NAME]</div>}
        </div>
      </div>

      <div className="col" style={{ gap: 8 }}>
        <div className="row between">
          <div style={{ fontSize: 15, fontWeight: 600 }}>Strongest stretch picked</div>
          <div className="small muted">{RANGE[len]}</div>
        </div>
        <Segmented options={LENGTHS} value={len} onChange={setLen} variant="compact" />
      </div>

      <div className="col">
        <label className="option divided" style={{ gap: 14, minHeight: 46 }}>
          <span className="grow">Captions from the transcript</span>
          <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
        </label>
        <label className="option" style={{ gap: 14, minHeight: 46 }}>
          <span className="grow">Producer credit on screen</span>
          <input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} />
        </label>
      </div>

      <div className="foot">
        <button type="button" className="btn btn-primary">Share video</button>
        <NavLink to="/vault" center>Save to the vault</NavLink>
      </div>
    </Screen>
  )
}
