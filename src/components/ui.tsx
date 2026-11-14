import { useId, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'wouter'

/** Full-height phone screen. `gap` and `padBottom` vary per screen in the design. */
export function Screen({
  gap = 12,
  padBottom,
  style,
  children,
}: {
  gap?: number
  padBottom?: number
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <main
      className="screen"
      style={{ gap, ...(padBottom ? { paddingBottom: padBottom } : null), ...style }}
    >
      {children}
    </main>
  )
}

export function TopBar({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="topbar">
      {typeof left === 'string' ? <h1 className="title" style={{ margin: 0 }}>{left}</h1> : left}
      {right}
    </div>
  )
}

export function NavLink({
  to,
  children,
  center,
  style,
}: {
  to: string
  children: ReactNode
  center?: boolean
  style?: CSSProperties
}) {
  return (
    <Link href={to} className={`link${center ? ' center' : ''}`} style={style}>
      {children}
    </Link>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  variant?: 'inset' | 'compact'
}) {
  return (
    <div className={`segmented${variant ? ` ${variant}` : ''}${variant === 'inset' ? ' compact' : ''}`}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  wrap,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  wrap?: boolean
}) {
  return (
    <div className={`chips${wrap ? ' wrap' : ''}`}>
      {options.map((o) => (
        <button key={o} type="button" className="chip" aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

export type Bar = { h: number; c?: string }

/** Deterministic pseudo-random waveform, same generator the design uses. */
export function makeBars(seed: number, count: number, shape: (i: number, r: number) => Bar): Bar[] {
  const bars: Bar[] = []
  let s = seed
  for (let i = 0; i < count; i++) {
    s = (s * 9301 + 49297) % 233280
    bars.push(shape(i, s / 233280))
  }
  return bars
}

export function Bars({
  bars,
  height,
  color,
  style,
}: {
  bars: Bar[]
  height: number
  color?: string
  style?: CSSProperties
}) {
  return (
    <div className="bars" aria-hidden="true" style={{ height, ...style }}>
      {bars.map((b, i) => (
        <i key={i} style={{ height: b.h, background: b.c ?? color }} />
      ))}
    </div>
  )
}

export function Meter({
  label,
  pct,
  height = 6,
  accent,
}: {
  label?: string
  pct: number
  height?: number
  accent?: boolean
}) {
  return (
    <div className="row" style={{ gap: 10 }}>
      {label && (
        <div className="muted" style={{ fontSize: 12, width: 10 }}>
          {label}
        </div>
      )}
      <div className={`meter${accent ? ' accent' : ''}`} style={{ height }}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function SliderRow({
  label,
  value,
  display,
  onChange,
  min = 0,
  max = 100,
  labelWidth = 76,
  valueWidth = 62,
  minHeight = 40,
  fontSize = 14,
}: {
  label: string
  value: number
  display?: string
  onChange: (v: number) => void
  min?: number
  max?: number
  labelWidth?: number
  valueWidth?: number
  minHeight?: number
  fontSize?: number
}) {
  const id = useId()
  return (
    <div className="slider-row" style={{ minHeight }}>
      <label htmlFor={id} style={{ width: labelWidth, fontSize }}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {display !== undefined && <output style={{ width: valueWidth }}>{display}</output>}
    </div>
  )
}

export function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 18 18" fill="currentColor">
      <path d="M5 3l10 6-10 6z" />
    </svg>
  )
}

export function PauseIcon({ size = 26 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20" fill="currentColor">
      <rect x="4" y="3" width="4" height="14" rx="1" />
      <rect x="12" y="3" width="4" height="14" rx="1" />
    </svg>
  )
}

/** Signed dB with a real minus sign, as the design writes it. */
export function db(v: number, digits = 0) {
  const n = Math.abs(v).toFixed(digits)
  return `${v < 0 ? '−' : v > 0 ? '+' : ''}${n} dB`
}
