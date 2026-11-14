import { biquad, filter, fromDb, limit, toDb } from './core';
import type { Chain } from './presets';

// Effects work in place on arrays of channels (one array for mono, two for stereo).

export function equalise(channels: Float32Array[], sampleRate: number, bands: Chain['eq']) {
  for (const band of bands) {
    if (Math.abs(band.gain) < 0.05) continue;
    const c = biquad(band.type, band.freq, sampleRate, band.q, band.gain);
    for (let i = 0; i < channels.length; i++) channels[i] = filter(channels[i], c);
  }
}

export function highpass(channels: Float32Array[], sampleRate: number, freq: number) {
  const c = biquad('highpass', freq, sampleRate);
  for (let i = 0; i < channels.length; i++) channels[i] = filter(channels[i], c);
}

export function lowpass(channels: Float32Array[], sampleRate: number, freq: number) {
  const c = biquad('lowpass', freq, sampleRate);
  for (let i = 0; i < channels.length; i++) channels[i] = filter(channels[i], c);
}

/** Feed-forward compressor with a soft knee. Returns the average gain reduction while it was working, in dB. */
export function compress(channels: Float32Array[], sampleRate: number, comp: Chain['comp']): number {
  const n = channels[0]?.length ?? 0;
  if (comp.ratio <= 1.01) {
    if (comp.makeup) for (const ch of channels) for (let i = 0; i < n; i++) ch[i] *= fromDb(comp.makeup);
    return 0;
  }
  const knee = 6;
  const slope = 1 - 1 / comp.ratio;
  const attack = Math.exp(-1 / ((sampleRate * Math.max(0.1, comp.attack)) / 1000));
  const release = Math.exp(-1 / ((sampleRate * Math.max(1, comp.release)) / 1000));
  const makeup = fromDb(comp.makeup);
  // Below this level the compressor does nothing, which is most of the time on a beat;
  // checking it first avoids a logarithm for every sample.
  const floor = fromDb(comp.threshold - knee / 2);
  const DB = 8.685889638065035; // 20 / ln(10)
  let reduction = 0, sum = 0, active = 0;
  // Plain indexed access to one or two channels: this loop runs for every sample of the song.
  const a = channels[0];
  const b = channels.length > 1 ? channels[1] : null;
  for (let i = 0; i < n; i++) {
    let p = a[i] < 0 ? -a[i] : a[i];
    if (b) {
      const v = b[i] < 0 ? -b[i] : b[i];
      if (v > p) p = v;
    }
    let want = 0;
    if (p > floor) {
      const over = Math.log(p) * DB - comp.threshold;
      want = over > knee / 2 ? over * slope : (slope * (over + knee / 2) * (over + knee / 2)) / (2 * knee);
    } else if (reduction < 1e-4) {
      if (makeup !== 1) {
        a[i] *= makeup;
        if (b) b[i] *= makeup;
      }
      continue;
    }
    reduction = want > reduction ? attack * reduction + (1 - attack) * want : release * reduction + (1 - release) * want;
    if (reduction > 0.1) {
      sum += reduction;
      active++;
    }
    const g = Math.exp(-reduction / DB) * makeup;
    a[i] *= g;
    if (b) b[i] *= g;
  }
  return active ? -sum / active : 0;
}

/** Turns down only the top of the signal when sibilance jumps out. */
export function deess(channels: Float32Array[], sampleRate: number, settings: Chain['deess']) {
  if (settings.amount <= 0.05) return;
  const n = channels[0]?.length ?? 0;
  const c = biquad('highpass', settings.freq, sampleRate);
  const highs = channels.map((ch) => filter(ch, c));
  // The threshold sits just above how loud the top end usually is in this take.
  let sum = 0, count = 0;
  for (const h of highs) for (let i = 0; i < n; i += 4) {
    const v = h[i] * h[i];
    if (v > 1e-8) { sum += v; count++; }
  }
  if (!count) return;
  const threshold = toDb(Math.sqrt(sum / count)) + 4;
  const attack = Math.exp(-1 / (sampleRate * 0.001));
  const release = Math.exp(-1 / (sampleRate * 0.06));
  let env = 0;
  const limitLinear = fromDb(threshold);
  const h0 = highs[0];
  const h1 = highs.length > 1 ? highs[1] : null;
  for (let i = 0; i < n; i++) {
    let p = h0[i] < 0 ? -h0[i] : h0[i];
    if (h1) {
      const v = h1[i] < 0 ? -h1[i] : h1[i];
      if (v > p) p = v;
    }
    env = p > env ? attack * env + (1 - attack) * p : release * env + (1 - release) * p;
    if (env <= limitLinear) continue;
    const over = toDb(env) - threshold;
    const g = fromDb(-Math.min(settings.amount, over * 0.8)) - 1;
    // Low band plus a quieter high band: the split is subtractive, so it adds back up exactly.
    for (let c2 = 0; c2 < channels.length; c2++) channels[c2][i] += highs[c2][i] * g;
  }
}

/** Soft clipping. `amount` 0–1 sets how hard the signal is driven. */
export function saturate(channels: Float32Array[], amount: number) {
  if (amount <= 0.01) return;
  const drive = 1 + amount * 4;
  const norm = 1 / Math.tanh(drive);
  const wet = Math.min(1, 0.35 + amount * 0.65);
  for (const ch of channels) for (let i = 0; i < ch.length; i++) {
    ch[i] = ch[i] * (1 - wet) + Math.tanh(ch[i] * drive) * norm * wet * (1 / (1 + amount * 0.6));
  }
}

/** Runs one whole chain. Returns the compressor's average gain reduction in dB. */
export function runChain(channels: Float32Array[], sampleRate: number, chain: Chain): number {
  equalise(channels, sampleRate, chain.eq);
  const reduction = compress(channels, sampleRate, chain.comp);
  deess(channels, sampleRate, chain.deess);
  limit(channels, sampleRate, chain.limiter.ceiling, chain.limiter.release);
  return reduction;
}

/** A delayed copy read back at a slowly wandering speed: the basis of doubling and tape wobble. */
function wanderingDelay(x: Float32Array, sampleRate: number, delayMs: number, depthMs: number, rateHz: number, phase: number): Float32Array {
  const out = new Float32Array(x.length);
  const base = (delayMs / 1000) * sampleRate;
  const depth = (depthMs / 1000) * sampleRate;
  const w = (2 * Math.PI * rateHz) / sampleRate;
  for (let i = 0; i < x.length; i++) {
    const at = i - base - depth * Math.sin(w * i + phase);
    if (at < 0) continue;
    const lo = Math.floor(at);
    const frac = at - lo;
    out[i] = x[lo] * (1 - frac) + (lo + 1 < x.length ? x[lo + 1] : 0) * frac;
  }
  return out;
}

/** Two slightly late, slightly detuned copies, one each side. Returns stereo. */
export function doubleTrack(mono: Float32Array, sampleRate: number, level = 0.42): [Float32Array, Float32Array] {
  const left = wanderingDelay(mono, sampleRate, 17, 1.1, 0.31, 0);
  const right = wanderingDelay(mono, sampleRate, 26, 1.3, 0.37, 1.7);
  for (let i = 0; i < mono.length; i++) {
    left[i] *= level;
    right[i] *= level;
  }
  return [left, right];
}

/** Tape-style pitch wobble across a whole mix, in place. */
export function wobble(channels: Float32Array[], sampleRate: number) {
  for (let c = 0; c < channels.length; c++) channels[c] = wanderingDelay(channels[c], sampleRate, 4, 0.9, 0.7, c * 0.2);
}

/** A small room reverb (the classic comb-and-allpass design). Mono in, stereo wet signal out. */
export function reverb(mono: Float32Array, sampleRate: number, roomSize = 0.78, damping = 0.35): [Float32Array, Float32Array] {
  const scale = sampleRate / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allpasses = [556, 441, 341, 225];
  const n = mono.length;
  const render = (spread: number) => {
    const out = new Float32Array(n);
    for (const length of combs) {
      const size = Math.round((length + spread) * scale);
      const buf = new Float32Array(size);
      let at = 0, store = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[at];
        store = y * (1 - damping) + store * damping;
        buf[at] = mono[i] * 0.015 + store * roomSize;
        if (++at === size) at = 0;
        out[i] += y;
      }
    }
    for (const length of allpasses) {
      const size = Math.round((length + spread) * scale);
      const buf = new Float32Array(size);
      let at = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[at];
        const y = b - out[i];
        buf[at] = out[i] + b * 0.5;
        if (++at === size) at = 0;
        out[i] = y;
      }
    }
    return out;
  };
  return [render(0), render(23)];
}
