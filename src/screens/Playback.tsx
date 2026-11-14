import { useState } from 'react'
import { Link } from 'wouter'
import { Bars, Chips, makeBars, NavLink, Screen, Segmented, SliderRow, TopBar } from '../components/ui'

const SIDES = ['Raw take', 'Polished'] as const
const STYLES = ['Upfront', 'Melodic', 'Dark', 'Gritty'] as const
const STEPS = ['Beat removed from mic', 'Road noise cleaned', 'Timing put on the grid', 'Chain matched to voice']

const bars = makeBars(11, 68, (i, r) => {
  const phrase = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.42))
  return { h: Math.round(8 + r * phrase * 60), c: i < 30 ? 'var(--accent)' : 'var(--wave-dim)' }
})

export function Playback() {
  const [side, setSide] = useState<(typeof SIDES)[number]>('Polished')
  const [style, setStyle] = useState<(typeof STYLES)[number]>('Upfront')
  const [open, setOpen] = useState(false)
  const [double, setDouble] = useState(true)
  const [tune, setTune] = useState(false)
  const [vox, setVox] = useState(68)

  return (
    <Screen>
      <TopBar left={<div className="eyebrow accent">Auto polish · playing</div>} right={<NavLink to="/vocals">Back</NavLink>} />

      <div className="col" style={{ gap: 6 }}>
        <h1 className="display" style={{ fontSize: 40, letterSpacing: '-0.03em', lineHeight: 1, margin: 0 }}>Take 3</h1>
        <div className="muted" style={{ fontSize: 15 }}>Night bus · 0:48 · ready in 3 seconds</div>
      </div>

      <Segmented options={SIDES} value={side} onChange={setSide} />

      <Bars bars={bars} height={44} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 12px' }}>
        {STEPS.map((label) => (
          <div key={label} className="row small" style={{ gap: 8, fontWeight: 500 }}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
              <path d="M2 7.5l3.2 3L12 3.5" />
            </svg>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <Chips options={STYLES} value={style} onChange={setStyle} />

      <button type="button" className="disclosure last" style={{ fontSize: 15 }} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Tweak it</span>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="col">
          <label className="option" style={{ gap: 14, minHeight: 46, fontWeight: 400 }}>
            <span className="grow">Double track, nudged and panned</span>
            <input type="checkbox" checked={double} onChange={(e) => setDouble(e.target.checked)} />
          </label>
          <label className="option" style={{ gap: 14, minHeight: 46, fontWeight: 400 }}>
            <span className="grow">Tune to F minor</span>
            <input type="checkbox" checked={tune} onChange={(e) => setTune(e.target.checked)} />
          </label>
          <SliderRow label="Vocal level" value={vox} onChange={setVox} labelWidth={92} minHeight={44} fontSize={15} />
          <Link
            href="/advanced"
            className="row between"
            style={{ fontSize: 15, fontWeight: 600, minHeight: 44, textDecoration: 'none' }}
          >
            <span>Advanced: EQ, compressor, de-esser, limiter</span>
            <span aria-hidden="true">›</span>
          </Link>
        </div>
      )}

      <div className="foot">
        <Link href="/vocals" className="btn btn-light">Run it back</Link>
        <div className="row" style={{ gap: 10 }}>
          <Link href="/vault" className="btn btn-outline" style={{ borderRadius: 14 }}>Keep</Link>
          <Link href="/snippet" className="btn btn-outline" style={{ borderRadius: 14 }}>Snippet</Link>
          <Link href="/master" className="btn btn-outline" style={{ borderRadius: 14 }}>Master</Link>
        </div>
      </div>
    </Screen>
  )
}
