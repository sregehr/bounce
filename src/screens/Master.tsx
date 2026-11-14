import { useId, useState } from 'react'
import { Link } from 'wouter'
import { Chips, db, NavLink, Screen, Segmented, SliderRow, TopBar } from '../components/ui'

const SIDES = ['Original', 'Mastered'] as const

const NOTES = {
  Auto: 'Listened to the whole track and matched it to a reference curve: lows up 2 dB, harshness around 3 kHz pulled back, gentle glue compression.',
  Punchy: 'Slower compressor attack so drums hit harder, a tight low-end bump, and a touch more top.',
  Warm: 'Rolled off the very top, added low-mid body, and soft saturation before the limiter.',
  Loud: 'Heavier compression and the limiter pushed hard. Maximum level, less dynamics.',
  'Lo-fi': 'Narrowed the highs and lows, added tape-style saturation and a little wobble.',
} as const
type Style = keyof typeof NOTES
const STYLES = Object.keys(NOTES) as Style[]

export function Master() {
  const [side, setSide] = useState<(typeof SIDES)[number]>('Mastered')
  const [style, setStyle] = useState<Style>('Auto')
  const [amount, setAmount] = useState(70)
  const [low, setLow] = useState(2)
  const [mid, setMid] = useState(-1)
  const [high, setHigh] = useState(1)
  const [comp, setComp] = useState(45)
  const amountId = useId()
  const fine = { labelWidth: 92, valueWidth: 50, minHeight: 44 }

  return (
    <Screen gap={14} padBottom={32}>
      <TopBar left="Master" right={<NavLink to="/playback">Back</NavLink>} />

      <Segmented options={SIDES} value={side} onChange={setSide} />
      <Chips options={STYLES} value={style} onChange={setStyle} wrap />

      <div className="card" style={{ borderRadius: 16, padding: '14px 16px', gap: 6 }}>
        <div className="eyebrow accent">What this style did</div>
        <div style={{ fontSize: 14, lineHeight: 1.45 }}>{NOTES[style]}</div>
      </div>

      <div className="col" style={{ gap: 2 }}>
        <div className="row between">
          <label htmlFor={amountId} style={{ fontSize: 15, fontWeight: 600 }}>Intensity</label>
          <div className="muted" style={{ fontSize: 14 }}>{amount}%</div>
        </div>
        <input
          id={amountId}
          type="range"
          min={0}
          max={100}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          style={{ width: '100%', height: 32 }}
        />
      </div>

      <div className="col">
        <div className="eyebrow" style={{ paddingBottom: 4 }}>Fine tune</div>
        <SliderRow {...fine} label="Low" min={-6} max={6} value={low} onChange={setLow} display={db(low)} />
        <SliderRow {...fine} label="Mid" min={-6} max={6} value={mid} onChange={setMid} display={db(mid)} />
        <SliderRow {...fine} label="High" min={-6} max={6} value={high} onChange={setHigh} display={db(high)} />
        <SliderRow {...fine} label="Compression" value={comp} onChange={setComp} display={`${comp}%`} />
      </div>

      <div className="foot" style={{ gap: 14 }}>
        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <div className="col" style={{ gap: 2 }}>
            <div className="muted" style={{ fontSize: 12 }}>Loudness now</div>
            <div className="display" style={{ fontSize: 24, letterSpacing: 0 }}>−9.4 LUFS</div>
          </div>
          <div className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
            <div className="muted" style={{ fontSize: 12 }}>True peak</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 18 }}>−1.0 dB</div>
          </div>
        </div>
        <Link href="/export" className="btn btn-primary">Export</Link>
      </div>
    </Screen>
  )
}
