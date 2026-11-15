// Pure audio maths with no platform dependencies, so it runs the same in a browser,
// in tests under Node, and later on a phone.

export type Stereo = [Float32Array, Float32Array];

export const toDb = (linear: number) => (linear > 1e-9 ? 20 * Math.log10(linear) : -180);
export const fromDb = (d: number) => Math.pow(10, d / 20);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------- Biquad filters (RBJ cookbook) ----------

export type BandType = 'lowshelf' | 'peaking' | 'highshelf' | 'highpass' | 'lowpass';
export type Coeffs = { b0: number; b1: number; b2: number; a1: number; a2: number };

export function biquad(type: BandType, freq: number, sampleRate: number, q = 0.7071, gainDb = 0): Coeffs {
  const w = (2 * Math.PI * clamp(freq, 10, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sin / (2 * Math.max(0.05, q));
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case 'peaking':
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const k = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + k);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - k);
      a0 = A + 1 + (A - 1) * cos + k;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - k;
      break;
    }
    case 'highshelf': {
      const k = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + k);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - k);
      a0 = A + 1 - (A - 1) * cos + k;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - k;
      break;
    }
    case 'highpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    default:
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Filters `x` into a new array. */
export function filter(x: Float32Array, c: Coeffs): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const out = c.b0 * v + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = out;
    y[i] = out;
  }
  return y;
}

/** Gain in dB of a filter at one frequency, for drawing an EQ curve. */
export function responseDb(c: Coeffs, freq: number, sampleRate: number) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2;
  const ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2;
  const di = -(c.a1 * s1 + c.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

// ---------- Levels ----------

export function peakOf(channels: Float32Array[]) {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) {
    const v = ch[i] < 0 ? -ch[i] : ch[i];
    if (v > p) p = v;
  }
  return p;
}

export function rmsDb(channels: Float32Array[]) {
  let sum = 0, n = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    n += ch.length;
  }
  return n ? toDb(Math.sqrt(sum / n)) : -180;
}

export function applyGain(channels: Float32Array[], gain: number) {
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
}

export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/** Normalised 0–1 peaks in `bins` equal slices, for waveform displays. */
export function wavePeaks(channels: Float32Array[], bins: number, from = 0, to = channels[0]?.length ?? 0): number[] {
  const out: number[] = [];
  const length = Math.max(0, to - from);
  let top = 0;
  for (let b = 0; b < bins; b++) {
    const a = from + Math.floor((b * length) / bins);
    const z = from + Math.floor(((b + 1) * length) / bins);
    let p = 0;
    // Sampling every few frames is plenty for a picture and keeps long files quick.
    const stride = Math.max(1, Math.floor((z - a) / 400));
    for (const ch of channels) for (let i = a; i < z; i += stride) {
      const v = ch[i] < 0 ? -ch[i] : ch[i];
      if (v > p) p = v;
    }
    out.push(p);
    if (p > top) top = p;
  }
  return top > 0 ? out.map((p) => p / top) : out;
}

// ---------- Loudness (ITU-R BS.1770) ----------

/** The two K-weighting filters from the standard, recalculated for any sample rate. */
function kWeighting(sampleRate: number): [Coeffs, Coeffs] {
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const vh = Math.pow(10, 3.999843853973347 / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const sq = 0.7071752369554196;
  const sa0 = 1 + shelfK / sq + shelfK * shelfK;
  const shelf = {
    b0: (vh + (vb * shelfK) / sq + shelfK * shelfK) / sa0,
    b1: (2 * (shelfK * shelfK - vh)) / sa0,
    b2: (vh - (vb * shelfK) / sq + shelfK * shelfK) / sa0,
    a1: (2 * (shelfK * shelfK - 1)) / sa0,
    a2: (1 - shelfK / sq + shelfK * shelfK) / sa0,
  };
  const k = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const hq = 0.5003270373238773;
  const ha0 = 1 + k / hq + k * k;
  const high = { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / ha0, a2: (1 - k / hq + k * k) / ha0 };
  return [shelf, high];
}

/** Integrated loudness in LUFS, with the standard absolute and relative gates. */
export function integratedLufs(channels: Float32Array[], sampleRate: number): number {
  const [shelf, high] = kWeighting(sampleRate);
  const weighted = channels.map((ch) => filter(filter(ch, shelf), high));
  const block = Math.round(sampleRate * 0.4);
  const hop = Math.round(sampleRate * 0.1);
  const n = weighted[0]?.length ?? 0;
  if (n < block) {
    // Too short for gating: fall back to the plain weighted power.
    let sum = 0;
    for (const ch of weighted) for (let i = 0; i < n; i++) sum += ch[i] * ch[i];
    return n ? -0.691 + 10 * Math.log10(sum / n + 1e-12) : -70;
  }
  const powers: number[] = [];
  for (let start = 0; start + block <= n; start += hop) {
    let sum = 0;
    for (const ch of weighted) for (let i = start; i < start + block; i++) sum += ch[i] * ch[i];
    powers.push(sum / block);
  }
  const loud = (p: number) => -0.691 + 10 * Math.log10(p + 1e-12);
  const gated = powers.filter((p) => loud(p) > -70);
  if (gated.length === 0) return -70;
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  const relative = loud(mean(gated)) - 10;
  const kept = gated.filter((p) => loud(p) > relative);
  return kept.length ? loud(mean(kept)) : -70;
}

/** Peak after 4x oversampling, which catches peaks between samples. */
export function truePeakDb(channels: Float32Array[]): number {
  // 4x polyphase windowed-sinc interpolator, 12 taps per phase.
  const taps = 12, phases = 4;
  const table: Float32Array[] = [];
  for (let p = 1; p < phases; p++) {
    const h = new Float32Array(taps);
    for (let k = 0; k < taps; k++) {
      const t = k - (taps / 2 - 1) - p / phases;
      const sinc = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const win = 0.5 + 0.5 * Math.cos((Math.PI * t) / (taps / 2));
      h[k] = sinc * Math.max(0, win);
    }
    table.push(h);
  }
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] < 0 ? -ch[i] : ch[i];
      if (v > peak) peak = v;
      // Only bother interpolating near the loud parts.
      if (v > peak * 0.7 && i >= taps / 2 && i < ch.length - taps / 2) {
        for (const h of table) {
          let acc = 0;
          for (let k = 0; k < taps; k++) acc += ch[i - (taps / 2 - 1) + k] * h[k];
          if (acc < 0) acc = -acc;
          if (acc > peak) peak = acc;
        }
      }
    }
  }
  return toDb(peak);
}

// ---------- Limiter ----------

/** Brickwall look-ahead limiter, in place. Returns the deepest gain reduction in dB (0 or negative). */
export function limit(channels: Float32Array[], sampleRate: number, ceilingDb = -1, releaseMs = 80, lookaheadMs = 5): number {
  const n = channels[0]?.length ?? 0;
  if (n === 0) return 0;
  const ceiling = fromDb(ceilingDb);
  const look = Math.max(1, Math.round((sampleRate * lookaheadMs) / 1000));
  // Gain each sample needs on its own.
  const need = new Float32Array(n);
  const a = channels[0];
  const b = channels.length > 1 ? channels[1] : null;
  let any = false;
  for (let i = 0; i < n; i++) {
    let p = a[i] < 0 ? -a[i] : a[i];
    if (b) {
      const v = b[i] < 0 ? -b[i] : b[i];
      if (v > p) p = v;
    }
    if (p > ceiling) {
      need[i] = ceiling / p;
      any = true;
    } else need[i] = 1;
  }
  // Nothing reaches the ceiling: leave the audio exactly as it is.
  if (!any) return 0;
  // Minimum over the look-ahead window (so the gain is already down when a peak arrives),
  // with an exponential release afterwards.
  const release = Math.exp(-1 / ((sampleRate * releaseMs) / 1000));
  const held = new Float32Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0, env = 1;
  for (let i = 0; i < n + look; i++) {
    if (i < n) {
      while (tail > head && need[queue[tail - 1]] >= need[i]) tail--;
      queue[tail++] = i;
    }
    const out = i - look;
    if (out < 0) continue;
    while (queue[head] < out) head++;
    const target = need[queue[head]];
    env = target < env ? target : 1 - (1 - env) * release;
    if (env > target) env = Math.min(env, target);
    held[out] = env;
  }
  // Smooth the steps into ramps across the look-ahead window.
  let sum = 0, deepest = 1;
  const smooth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sum += held[Math.min(n - 1, i + look - 1)];
    if (i >= look) sum -= held[i - 1];
    const count = Math.min(i + 1, look);
    // Averaging can only raise the gain above the held minimum, so cap it.
    const g = Math.min(held[i], i >= look - 1 ? sum / look : sum / count);
    smooth[i] = g;
    if (g < deepest) deepest = g;
  }
  for (const ch of channels) for (let i = 0; i < n; i++) ch[i] *= smooth[i];
  return toDb(deepest);
}

export type Finalised = { lufs: number; truePeakDb: number; gainDb: number; reductionDb: number };

/**
 * The work of `finalise`, pausing after each pass so a caller can let the screen breathe
 * in between. Works in place.
 */
function* finaliseSteps(channels: Float32Array[], sampleRate: number, targetLufs: number | null, ceilingDb: number, releaseMs: number): Generator<void, Finalised> {
  const before = integratedLufs(channels, sampleRate);
  let gainDb = 0, reductionDb = 0;
  // The limiter works on samples, but peaks between samples can still poke through,
  // most of all on bright material. `margin` is how far under the ceiling it has to aim.
  let margin = 0.3;
  const limitAndCheck = () => {
    reductionDb = Math.min(reductionDb, limit(channels, sampleRate, ceilingDb - margin, releaseMs));
    const over = truePeakDb(channels) - ceilingDb;
    if (over > 0.02) {
      applyGain(channels, fromDb(-over));
      margin = Math.min(4, margin + over);
    }
  };
  // Anything already over the ceiling is dealt with first, whatever the loudness.
  const hot = toDb(peakOf(channels)) > ceilingDb - margin;
  if (hot) limitAndCheck();
  if (targetLufs !== null && before > -60) {
    // Limiting takes some loudness back, so close in on the target over a few passes.
    for (let pass = 0; pass < 5; pass++) {
      yield;
      const now = pass === 0 && !hot ? before : integratedLufs(channels, sampleRate);
      // After the first pass the gap is what the limiter took back; it will take some of the
      // next step too, so overshoot a little to get there in fewer passes.
      const gap = targetLufs - now;
      if (Math.abs(gap) < 0.3) break;
      const step = clamp(pass === 0 ? gap : gap * 1.3, -30, pass === 0 ? 24 : 6);
      applyGain(channels, fromDb(step));
      gainDb += step;
      limitAndCheck();
    }
  }
  yield;
  return { lufs: integratedLufs(channels, sampleRate), truePeakDb: truePeakDb(channels), gainDb, reductionDb };
}

/** Brings a mix to a loudness target under a peak ceiling. Works in place. */
export function finalise(channels: Float32Array[], sampleRate: number, targetLufs: number | null, ceilingDb = -1, releaseMs = 80): Finalised {
  const steps = finaliseSteps(channels, sampleRate, targetLufs, ceilingDb, releaseMs);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** The same as `finalise`, calling `pause` between passes. */
export async function finaliseGently(channels: Float32Array[], sampleRate: number, targetLufs: number | null, ceilingDb: number, releaseMs: number, pause: () => Promise<void>): Promise<Finalised> {
  const steps = finaliseSteps(channels, sampleRate, targetLufs, ceilingDb, releaseMs);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await pause();
  }
}

// ---------- Trimming ----------

/** Frame range with the silence taken off both ends, keeping a short lead-in and tail. */
export function trimRange(channels: Float32Array[], sampleRate: number, threshold = 0.003) {
  const n = channels[0]?.length ?? 0;
  const loud = (i: number) => channels.some((ch) => Math.abs(ch[i]) > threshold);
  let first = 0;
  while (first < n && !loud(first)) first++;
  if (first === n) return { start: 0, end: 0 };
  let last = n - 1;
  while (last > first && !loud(last)) last--;
  return { start: Math.max(0, first - Math.round(sampleRate * 0.02)), end: Math.min(n, last + 1 + Math.round(sampleRate * 0.25)) };
}

// ---------- Noise reduction ----------

/** Gentle downward expander: turns the gaps between phrases down. In place. Returns the threshold it chose, in dB. */
export function reduceNoise(channels: Float32Array[], sampleRate: number, maxCutDb = 12): number {
  const n = channels[0]?.length ?? 0;
  const frame = Math.round(sampleRate * 0.02);
  if (n < frame * 10) return -180;
  // Estimate the noise floor from the quietest stretches.
  const levels: number[] = [];
  for (let start = 0; start + frame <= n; start += frame) {
    let sum = 0;
    for (const ch of channels) for (let i = start; i < start + frame; i++) sum += ch[i] * ch[i];
    levels.push(toDb(Math.sqrt(sum / (frame * channels.length))));
  }
  // Digital silence (the padding out to the bar line) is not the room: leave it out of the estimate.
  const sorted = levels.filter((l) => l > -110).sort((a, b) => a - b);
  if (sorted.length < 10) return -180;
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const body = sorted[Math.floor(sorted.length * 0.9)];
  // Nothing to gain when the take is already clean or has no quiet parts.
  if (body - floor < 12) return -180;
  const threshold = Math.min(floor + 0.4 * (body - floor), body - 12);
  const attack = Math.exp(-1 / (sampleRate * 0.004));
  const release = Math.exp(-1 / (sampleRate * 0.03));
  let env = 0, gain = 1;
  const thresholdLinear = fromDb(threshold);
  // Open fast so consonants are not clipped; close slowly so tails are not chopped.
  const gAttack = Math.exp(-1 / (sampleRate * 0.003));
  const gRelease = Math.exp(-1 / (sampleRate * 0.08));
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (let c = 0; c < channels.length; c++) {
      const v = channels[c][i] < 0 ? -channels[c][i] : channels[c][i];
      if (v > p) p = v;
    }
    env = p > env ? attack * env + (1 - attack) * p : release * env + (1 - release) * p;
    // Above the threshold nothing is cut, so the logarithm is only needed below it.
    let target = 1;
    if (env < thresholdLinear) target = fromDb(-Math.min(maxCutDb, (threshold - toDb(env)) * 1.5));
    gain = target > gain ? gAttack * gain + (1 - gAttack) * target : gRelease * gain + (1 - gRelease) * target;
    for (let c = 0; c < channels.length; c++) channels[c][i] *= gain;
  }
  return threshold;
}

// ---------- Resampling helpers ----------

/** Averages down to roughly `targetRate`. Good enough for analysis, not for listening. */
export function decimate(x: Float32Array, sampleRate: number, targetRate: number): { data: Float32Array; rate: number } {
  const factor = Math.max(1, Math.floor(sampleRate / targetRate));
  if (factor === 1) return { data: x, rate: sampleRate };
  const low = filter(filter(x, biquad('lowpass', (sampleRate / factor) * 0.45, sampleRate)), biquad('lowpass', (sampleRate / factor) * 0.45, sampleRate));
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let i = 0; i < out.length; i++) out[i] = low[i * factor];
  return { data: out, rate: sampleRate / factor };
}

// ---------- FFT ----------

/** In-place radix-2 FFT. `re` and `im` must have a power-of-two length. */
export function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Magnitude spectrum of one Hann-windowed frame. */
export function magnitudes(x: Float32Array, start: number, size: number, re: Float32Array, im: Float32Array, out: Float32Array) {
  for (let i = 0; i < size; i++) {
    const v = start + i < x.length ? x[start + i] : 0;
    re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
    im[i] = 0;
  }
  fft(re, im);
  for (let i = 0; i < size / 2; i++) out[i] = Math.hypot(re[i], im[i]);
}
