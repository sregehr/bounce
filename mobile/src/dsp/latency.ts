import { toDb } from './core';

export const CLICKS = { count: 6, first: 0.5, spacing: 0.4, tail: 0.3 } as const;
export const clickTrainSeconds = CLICKS.first + CLICKS.spacing * CLICKS.count + CLICKS.tail;

export type LatencyResult = { detected: number; clicks: number; medianMs: number | null; minMs: number | null; maxMs: number | null; noiseFloorDb: number };

/** Six short 3 kHz bursts with silence between, for timing the trip from output to input. */
export function makeClickTrain(sampleRate: number): Float32Array {
  const x = new Float32Array(Math.round(clickTrainSeconds * sampleRate));
  const burst = Math.round(0.003 * sampleRate);
  for (let k = 0; k < CLICKS.count; k++) {
    const start = Math.round((CLICKS.first + CLICKS.spacing * k) * sampleRate);
    for (let i = 0; i < burst; i++) x[start + i] = 0.9 * Math.sin((2 * Math.PI * 3000 * i) / sampleRate);
  }
  return x;
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
