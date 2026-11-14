/** Design tokens, carried over from the original Bounce design. */
export const C = {
  bg: '#121212',
  surface: '#1c1c1c',
  line: '#2a2a2a',
  border: '#333333',
  borderStrong: '#4a4a4a',
  dim: '#3a3a3a',
  waveDim: '#6e6c68',
  text: '#f2f0ea',
  muted: '#a8a6a0',
  accent: '#ffb020',
  accentHover: '#ffc555',
  rec: '#ff4b3e',
  recText: '#ff6b5e',
  recHalo: '#2a1614',
} as const;

/** Each weight is its own font family, as React Native needs. */
export const F = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semi: 'Inter_600SemiBold',
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
} as const;

export type Weight = keyof typeof F;

/** Signed dB with a real minus sign, as the design writes it. */
export function db(v: number, digits = 0) {
  if (!Number.isFinite(v)) return '−∞ dB';
  const n = Math.abs(v).toFixed(digits);
  const zero = Number(n) === 0;
  return `${zero ? '' : v < 0 ? '−' : '+'}${n} dB`;
}

export function lufs(v: number, digits = 1) {
  if (!Number.isFinite(v)) return '– LUFS';
  return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)} LUFS`;
}

export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function rateLabel(rate: number) {
  const k = rate / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)} kHz`;
}

/** Meter position for a linear level: −60 dB to 0 dB across the bar. */
export function meterPct(linear: number) {
  if (linear <= 0) return 0;
  const d = 20 * Math.log10(linear);
  return Math.max(0, Math.min(100, ((d + 60) / 60) * 100));
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Today", "Yesterday", a weekday within the last week, otherwise a short date. */
export function dayLabel(time: number, now = Date.now()) {
  const start = (t: number) => new Date(new Date(t).toDateString()).getTime();
  const days = Math.round((start(now) - start(time)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(time).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
