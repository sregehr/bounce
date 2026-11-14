import { biquad, decimate, filter, magnitudes, rmsDb, toDb, toMono } from './core';

// ---------- Tempo ----------

export type Tempo = { bpm: number; confidence: number };

/**
 * Tempo from the rhythm of onsets. The first estimate comes from how strongly the onset
 * pattern repeats at each beat length; it is then sharpened against repeats many beats
 * apart, which is what makes a 16-bar loop land on the grid.
 */
export function detectTempo(channels: Float32Array[], sampleRate: number): Tempo | null {
  const { data, rate } = decimate(toMono(channels), sampleRate, 11025);
  const size = 512, hop = 128;
  const frames = Math.floor((data.length - size) / hop);
  if (frames < 300) return null;
  const fps = rate / hop;

  // Onset strength: how much louder each frequency got since the last frame.
  const re = new Float32Array(size), im = new Float32Array(size);
  let prev = new Float32Array(size / 2), mag = new Float32Array(size / 2);
  const onset = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    magnitudes(data, f * hop, size, re, im, mag);
    let flux = 0;
    for (let k = 1; k < size / 2; k++) {
      const now = Math.log1p(100 * mag[k]);
      mag[k] = now;
      const d = now - prev[k];
      if (d > 0) flux += d;
    }
    onset[f] = flux;
    const swap = prev; prev = mag; mag = swap;
  }
  let mean = 0;
  for (let f = 0; f < frames; f++) mean += onset[f];
  mean /= frames;
  for (let f = 0; f < frames; f++) onset[f] -= mean;

  const acf = (lag: number) => {
    // Linear interpolation lets lags fall between frames.
    const lo = Math.floor(lag), frac = lag - lo;
    let sum = 0;
    const n = frames - lo - 1;
    if (n <= 0) return 0;
    for (let f = 0; f < n; f++) sum += onset[f] * (onset[f + lo] * (1 - frac) + onset[f + lo + 1] * frac);
    return sum / n;
  };
  const zero = acf(0) || 1;

  // A tempo only counts if the rhythm really repeats one beat apart; this rules out
  // answers that are 2/3 or 3/2 of the real tempo, which only line up every few beats.
  const candidates: { bpm: number; base: number; score: number }[] = [];
  let strongest = 0;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    const base = acf(lag);
    // A real beat also repeats at two and four beats.
    candidates.push({ bpm, base, score: base + 0.5 * acf(lag * 2) + 0.25 * acf(lag * 4) });
    if (base > strongest) strongest = base;
  }
  let best = { bpm: 0, score: -Infinity };
  for (const c of candidates) {
    if (c.base < strongest * 0.5) continue;
    // Half and double time explain the same rhythm; lean towards the middle of the usual range.
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(c.bpm / 100) / 0.75, 2));
    const weighted = (c.score / zero) * (0.3 + 0.7 * prior);
    if (weighted > best.score) best = { bpm: c.bpm, score: weighted };
  }
  if (best.score <= 0) return null;

  // Sharpen against repeats 2, 4, 8, 16 and 32 beats apart.
  let lag = (60 / best.bpm) * fps;
  for (const beats of [2, 4, 8, 16, 32]) {
    const centre = lag * beats;
    if (centre + 2 >= frames * 0.6) break;
    let top = -Infinity, at = centre;
    const span = Math.max(1, lag * 0.04 * Math.sqrt(beats));
    for (let l = centre - span; l <= centre + span; l += 0.1) {
      const v = acf(l);
      if (v > top) { top = v; at = l; }
    }
    lag = at / beats;
  }
  let bpm = (60 * fps) / lag;
  // Drum machines run at round tempos; snap when we are already almost there.
  const round = Math.round(bpm * 2) / 2;
  if (Math.abs(bpm - round) < 0.12) bpm = round;
  return { bpm, confidence: Math.max(0, Math.min(1, best.score * 2)) };
}

// ---------- Key ----------

const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export type Key = { name: string; tonic: number; minor: boolean; confidence: number };

/** Musical key from which notes carry the most energy across the track. */
export function detectKey(channels: Float32Array[], sampleRate: number): Key | null {
  const { data, rate } = decimate(toMono(channels), sampleRate, 5512);
  const size = 4096, hop = 2048;
  if (data.length < size * 2) return null;
  const re = new Float32Array(size), im = new Float32Array(size), mag = new Float32Array(size / 2);
  const chroma = new Float64Array(12);
  for (let start = 0; start + size <= data.length; start += hop) {
    magnitudes(data, start, size, re, im, mag);
    for (let k = 1; k < size / 2; k++) {
      const freq = (k * rate) / size;
      if (freq < 55 || freq > 1760) continue;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const nearest = Math.round(midi);
      // Ignore energy that sits between two notes.
      if (Math.abs(midi - nearest) > 0.35) continue;
      chroma[((nearest % 12) + 12) % 12] += mag[k] * mag[k];
    }
  }
  const total = chroma.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const c = Array.from(chroma, (v) => Math.sqrt(v / total));

  const corr = (profile: number[], shift: number) => {
    let mx = 0, my = 0;
    for (let i = 0; i < 12; i++) { mx += c[i]; my += profile[i]; }
    mx /= 12; my /= 12;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) {
      const x = c[(i + shift) % 12] - mx, y = profile[i] - my;
      num += x * y; dx += x * x; dy += y * y;
    }
    return num / Math.sqrt(dx * dy || 1);
  };
  let best = { tonic: 0, minor: false, score: -Infinity }, second = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      const score = corr(minor ? MINOR : MAJOR, tonic);
      if (score > best.score) { second = best.score; best = { tonic, minor, score }; }
      else if (score > second) second = score;
    }
  }
  return { name: `${NOTES[best.tonic]} ${best.minor ? 'minor' : 'major'}`, tonic: best.tonic, minor: best.minor, confidence: Math.max(0, Math.min(1, (best.score - second) * 4 + 0.3)) };
}

// ---------- Tonal balance and voice measurements ----------

export type Balance = { low: number; mid: number; high: number };

/** Level of the lows (<200 Hz), mids and highs (>4 kHz) in dB relative to the whole. */
export function tonalBalance(channels: Float32Array[], sampleRate: number): Balance {
  const mono = toMono(channels);
  // Analyse up to 60 s from the middle; the balance of a track does not change much.
  const span = Math.min(mono.length, Math.round(sampleRate * 60));
  const from = Math.floor((mono.length - span) / 2);
  const x = mono.subarray(from, from + span);
  const all = rmsDb([x]);
  const low = filter(filter(x, biquad('lowpass', 200, sampleRate)), biquad('lowpass', 200, sampleRate));
  const high = filter(filter(x, biquad('highpass', 4000, sampleRate)), biquad('highpass', 4000, sampleRate));
  const mid = filter(filter(x, biquad('highpass', 200, sampleRate)), biquad('lowpass', 4000, sampleRate));
  return { low: rmsDb([low]) - all, mid: rmsDb([mid]) - all, high: rmsDb([high]) - all };
}

export type VoiceStats = {
  /** Level of the sung or spoken parts, ignoring the gaps. */
  bodyDb: number;
  peakDb: number;
  balance: Balance;
  /** How much of the top end is sibilance (5–9 kHz) relative to the body, in dB. */
  sibilanceDb: number;
  /** Share of the take that has a voice in it, 0–1. */
  activity: number;
};

export function measureVoice(channels: Float32Array[], sampleRate: number): VoiceStats {
  const mono = toMono(channels);
  const frame = Math.round(sampleRate * 0.05);
  const levels: number[] = [];
  let peak = 0;
  for (let start = 0; start + frame <= mono.length; start += frame) {
    let sum = 0;
    for (let i = start; i < start + frame; i++) {
      sum += mono[i] * mono[i];
      const v = mono[i] < 0 ? -mono[i] : mono[i];
      if (v > peak) peak = v;
    }
    levels.push(toDb(Math.sqrt(sum / frame)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const top = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : -180;
  const active = levels.filter((l) => l > top - 25);
  const bodyDb = active.length ? 10 * Math.log10(active.reduce((a, l) => a + Math.pow(10, l / 10), 0) / active.length) : -180;
  const sib = filter(filter(mono, biquad('highpass', 5000, sampleRate)), biquad('lowpass', 9000, sampleRate));
  return {
    bodyDb,
    peakDb: toDb(peak),
    balance: tonalBalance(channels, sampleRate),
    sibilanceDb: rmsDb([sib]) - rmsDb([mono]),
    activity: levels.length ? active.length / levels.length : 0,
  };
}

// ---------- Strongest stretch ----------

/** Start time of the loudest window of `lengthSec`, stepping in `stepSec` (a bar, when the tempo is known). */
export function strongestStretch(channels: Float32Array[], sampleRate: number, lengthSec: number, stepSec = 0.5): number {
  const mono = toMono(channels);
  const hop = Math.round(sampleRate * 0.1);
  const energy: number[] = [];
  for (let start = 0; start < mono.length; start += hop) {
    let sum = 0;
    const end = Math.min(mono.length, start + hop);
    for (let i = start; i < end; i++) sum += mono[i] * mono[i];
    energy.push(sum);
  }
  const total = mono.length / sampleRate;
  if (total <= lengthSec) return 0;
  const window = Math.round(lengthSec * 10);
  let best = 0, bestSum = -1;
  for (let t = 0; t + lengthSec <= total + 1e-6; t += stepSec) {
    const from = Math.round(t * 10);
    let sum = 0;
    for (let i = from; i < from + window && i < energy.length; i++) sum += energy[i];
    if (sum > bestSum) { bestSum = sum; best = t; }
  }
  return best;
}
