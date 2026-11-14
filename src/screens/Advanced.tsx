import { useState, type ReactNode } from 'react'
import { db, NavLink, Screen, Segmented, SliderRow, TopBar } from '../components/ui'

const CHAINS = ['Vocal', 'Beat', 'Master'] as const
type Section = 'eq' | 'comp' | 'deess' | 'lim' | ''

type Param = { label: string; pos: number; show: (pos: number) => string }

// Slider positions are 0–100; `show` maps a position to the value the design displays at its default.
const lin = (min: number, max: number) => (pos: number) => min + ((max - min) * pos) / 100
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')} kHz` : `${Math.round(v)} Hz`)
const logHz = (pos: number) => hz(20 * Math.pow(1000, pos / 100))

const BANDS = [
  { label: '90 Hz', freqPos: 12, freq: '90 Hz', gainPos: 62, gain: '+2.0 dB', qPos: 50, q: 'Shelf' },
  { label: '350 Hz', freqPos: 34, freq: '350 Hz', gainPos: 32, gain: '−3.0 dB', qPos: 44, q: 'Q 1.4' },
  { label: '3.2 kHz', freqPos: 66, freq: '3.2 kHz', gainPos: 58, gain: '+1.5 dB', qPos: 30, q: 'Q 0.9' },
  { label: '10 kHz', freqPos: 88, freq: '10 kHz', gainPos: 66, gain: '+2.5 dB', qPos: 50, q: 'Shelf' },
]

const COMP: Param[] = [
  { label: 'Threshold', pos: 55, show: (p) => db(Math.round(lin(-40, 0)(p))) },
  { label: 'Ratio', pos: 30, show: (p) => `${Math.round(lin(1, 8)(p))} : 1` },
  { label: 'Attack', pos: 22, show: (p) => `${Math.round(lin(1, 42)(p))} ms` },
  { label: 'Release', pos: 40, show: (p) => `${Math.round(lin(20, 270)(p) / 10) * 10} ms` },
  { label: 'Make-up', pos: 45, show: (p) => db(Math.round(lin(-5, 15)(p))) },
]
const DEESS: Param[] = [
  { label: 'Frequency', pos: 60, show: (p) => hz(Math.round(lin(2000, 9500)(p) / 100) * 100) },
  { label: 'Amount', pos: 42, show: (p) => db(Math.round(lin(0, -12)(p))) },
]
const LIM: Param[] = [
  { label: 'Ceiling', pos: 90, show: (p) => db(lin(-10, 0)(p), 1) },
  { label: 'Release', pos: 35, show: (p) => `${Math.round(lin(10, 210)(p) / 10) * 10} ms` },
]

function ParamList({ params }: { params: Param[] }) {
  const [pos, setPos] = useState(() => params.map((p) => p.pos))
  return (
    <>
      {params.map((p, i) => (
        <SliderRow
          key={p.label}
          label={p.label}
          value={pos[i]}
          display={p.show(pos[i])}
          onChange={(v) => setPos(pos.map((x, j) => (j === i ? v : x)))}
        />
      ))}
    </>
  )
}

function BandControls({ band }: { band: (typeof BANDS)[number] }) {
  const [freq, setFreq] = useState(band.freqPos)
  const [gain, setGain] = useState(band.gainPos)
  const [q, setQ] = useState(band.qPos)
  const shelf = band.q === 'Shelf'
  return (
    <>
      <SliderRow label="Frequency" value={freq} onChange={setFreq} display={freq === band.freqPos ? band.freq : logHz(freq)} />
      <SliderRow label="Gain" value={gain} onChange={setGain} display={gain === band.gainPos ? band.gain : db(lin(-12, 12)(gain), 1)} />
      <SliderRow label="Width" value={q} onChange={setQ} display={shelf ? 'Shelf' : q === band.qPos ? band.q : `Q ${lin(0.3, 2.8)(q).toFixed(1)}`} />
    </>
  )
}

function Disclosure({
  title,
  summary,
  open,
  onToggle,
  last,
  children,
}: {
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  last?: boolean
  children: ReactNode
}) {
  return (
    <>
      <button type="button" className={`disclosure${last ? ' last' : ''}`} aria-expanded={open} onClick={onToggle}>
        <span>{title}</span>
        <span>{summary}</span>
      </button>
      {open && children}
    </>
  )
}

export function Advanced() {
  const [chain, setChain] = useState<(typeof CHAINS)[number]>('Vocal')
  const [open, setOpen] = useState<Section>('eq')
  const [band, setBand] = useState(1)
  // Bumping this remounts the controls, which puts every slider back on Auto's values.
  const [resetKey, setResetKey] = useState(0)
  const toggle = (s: Section) => () => setOpen(open === s ? '' : s)

  return (
    <Screen gap={10}>
      <TopBar left="Advanced" right={<NavLink to="/master">Next: Master</NavLink>} />

      <Segmented options={CHAINS} value={chain} onChange={setChain} />

      <div className="row between" style={{ minHeight: 28 }}>
        <div className="small muted">Starting from what Auto chose for this take</div>
        <button type="button" className="link small" style={{ fontWeight: 600, minHeight: 28, flex: 'none' }} onClick={() => setResetKey(resetKey + 1)}>
          Reset
        </button>
      </div>

      <div key={`${chain}-${resetKey}`} style={{ display: 'contents' }}>
        <Disclosure title="EQ" summary="4 bands" open={open === 'eq'} onToggle={toggle('eq')}>
          <div className="col" style={{ gap: 8 }}>
            <svg aria-hidden="true" viewBox="0 0 342 92" fill="none" style={{ width: '100%', background: 'var(--surface)', borderRadius: 14, display: 'block' }}>
              <path d="M0 46h342" stroke="var(--dim)" strokeWidth="1" />
              <path d="M0 23h342M0 69h342" stroke="var(--line)" strokeWidth="1" />
              <path d="M0 34 C30 34 44 34 60 36 S100 58 122 58 S170 46 200 40 S236 34 252 36 S292 26 342 24" stroke="var(--accent)" strokeWidth="2.5" />
              <circle cx="44" cy="34" r="6" fill="var(--text)" />
              <circle cx="122" cy="58" r="6" fill="var(--text)" />
              <circle cx="226" cy="36" r="6" fill="var(--text)" />
              <circle cx="306" cy="25" r="6" fill="var(--text)" />
            </svg>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
              {BANDS.map((b, i) => (
                <button key={b.label} type="button" className="chip square" aria-pressed={i === band} onClick={() => setBand(i)}>
                  {b.label}
                </button>
              ))}
            </div>
            <div className="col">
              <BandControls key={band} band={BANDS[band]} />
            </div>
          </div>
        </Disclosure>

        <Disclosure title="Compressor" summary="−18 dB · 3:1 · 10 ms · 120 ms" open={open === 'comp'} onToggle={toggle('comp')}>
          <div className="col">
            <ParamList params={COMP} />
            <div className="row" style={{ minHeight: 32 }}>
              <div className="small muted" style={{ width: 76, flex: 'none' }}>Reduction</div>
              <div className="meter accent" style={{ height: 6 }}><i style={{ width: '38%' }} /></div>
              <div className="small muted" style={{ width: 62, textAlign: 'right', flex: 'none' }}>−4.6 dB</div>
            </div>
          </div>
        </Disclosure>

        <Disclosure title="De-esser" summary="6.5 kHz · −5 dB" open={open === 'deess'} onToggle={toggle('deess')}>
          <div className="col"><ParamList params={DEESS} /></div>
        </Disclosure>

        <Disclosure title="Limiter" summary="Ceiling −1.0 dB" open={open === 'lim'} onToggle={toggle('lim')} last>
          <div className="col"><ParamList params={LIM} /></div>
        </Disclosure>
      </div>

      <div className="foot">
        <button type="button" className="btn btn-outline" style={{ flex: 'none' }}>Save as my preset</button>
      </div>
    </Screen>
  )
}
