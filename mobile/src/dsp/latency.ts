import { toDb } from './core';

export const CLICKS = { count: 6, first: 0.5, spacing: 0.4, tail: 0.3, burst: 0.003 } as const;
export const clickTrainSeconds = CLICKS.first + CLICKS.spacing * CLICKS.count + CLICKS.tail;

/** A slower, longer-sounding train for tapping along to: a steady pulse a finger can follow. */
export const TAPS = { count: 8, first: 1.2, spacing: 0.6, tail: 0.8, burst: 0.012 } as const;
export const tapTrainSeconds = TAPS.first + TAPS.spacing * TAPS.count + TAPS.tail;

export type TapResult = { matched: number; clicks: number; medianMs: number | null; spreadMs: number | null };

export type LatencyResult = { detected: number; clicks: number; medianMs: number | null; minMs: number | null; maxMs: number | null; noiseFloorDb: number };

type Train = { count: number; first: number; spacing: number; tail: number; burst: number };

/** Short 3 kHz bursts with silence between: six for timing the trip from output to input, or the tap-along pulse. */
export function makeClickTrain(sampleRate: number, plan: Train = CLICKS): Float32Array {
  const x = new Float32Array(Math.round((plan.first + plan.spacing * plan.count + plan.tail) * sampleRate));
  const burst = Math.round(plan.burst * sampleRate);
  for (let k = 0; k < plan.count; k++) {
    const start = Math.round((plan.first + plan.spacing * k) * sampleRate);
    // The longer burst fades out so it sounds like a tick, not a beep.
    for (let i = 0; i < burst; i++) x[start + i] = 0.9 * (plan.burst > 0.005 ? 1 - i / burst : 1) * Math.sin((2 * Math.PI * 3000 * i) / sampleRate);
  }
  return x;
}

/**
 * Works out how late the clicks are heard from when someone tapped along to them.
 * `clicksMs` is when each click was sent to the output and `tapsMs` when each tap landed, on the same clock.
 */
export function analyseTaps(clicksMs: number[], tapsMs: number[]): TapResult {
  const spacing = TAPS.spacing * 1000;
  const early = 100; // a tap this far ahead of a click still belongs to it
  const offsets = new Map<number, number>();
  for (const tap of tapsMs) {
    const k = Math.floor((tap - clicksMs[0] + early) / spacing);
    if (k < 0 || k >= clicksMs.length || offsets.has(k)) continue;
    offsets.set(k, tap - clicksMs[k]);
  }
  const values = [...offsets.values()].sort((a, b) => a - b);
  // Fingers wander, so the earliest and latest taps are set aside before judging how steady the rest were.
  const core = values.length >= 6 ? values.slice(1, -1) : values;
  const spread = core.length ? core[core.length - 1] - core[0] : null;
  const ok = values.length >= 5 && spread !== null && spread < 90;
  return { matched: values.length, clicks: clicksMs.length, medianMs: ok ? Math.max(0, values[Math.floor(values.length / 2)]) : null, spreadMs: spread };
}

/** Finds each click in what the input heard. `heard` starts at the instant the click train started playing. */
export function analyseClicks(heard: Float32Array, sampleRate: number): LatencyResult {
  const quietEnd = Math.min(heard.length, Math.round((CLICKS.first - 0.1) * sampleRate));
  let noise = 0;
  for (let i = 0; i < quietEnd; i++) noise = Math.max(noise, Math.abs(heard[i]));
  const threshold = Math.max(0.01, noise * 6);
  const values: number[] = [];
  for (let k = 0; k < CLICKS.count; k++) {
    const expected = Math.round((CLICKS.first + CLICKS.spacing * k) * sampleRate);
    const end = Math.min(heard.length, expected + Math.round((CLICKS.spacing - 0.05) * sampleRate));
    let peak = 0;
    for (let i = expected; i < end; i++) peak = Math.max(peak, Math.abs(heard[i]));
    if (peak <= threshold) continue;
    for (let i = expected; i < end; i++) {
      if (Math.abs(heard[i]) >= peak * 0.5) {
        values.push(((i - expected) / sampleRate) * 1000);
        break;
      }
    }
  }
  values.sort((a, b) => a - b);
  // The clicks should agree with each other; if they do not, something else was making noise.
  const spread = values.length ? values[values.length - 1] - values[0] : 0;
  const ok = values.length >= 4 && spread < 12;
  return {
    detected: values.length,
    clicks: CLICKS.count,
    medianMs: ok ? values[Math.floor(values.length / 2)] : null,
    minMs: values.length ? values[0] : null,
    maxMs: values.length ? values[values.length - 1] : null,
    noiseFloorDb: toDb(noise),
  };
}
