import { peakOf, type Stereo } from './core';

export const DEMO = { name: 'Night bus', bpm: 92, key: 'F minor', bars: 8, sampleRate: 44100 } as const;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** A short boom-bap loop made from scratch, so the app can be tried without any gear. */
export function makeDemoBeat(): Stereo {
  const sr = DEMO.sampleRate;
  const beat = 60 / DEMO.bpm;
  const bar = beat * 4;
  const n = Math.round(bar * DEMO.bars * sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  let seed = 7;
  const noise = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return (seed / 233280) * 2 - 1;
  };
  const add = (at: number, length: number, fn: (t: number, i: number) => [number, number]) => {
    const from = Math.round(at * sr);
    const count = Math.round(length * sr);
    for (let i = 0; i < count && from + i < n; i++) {
      const [l, r] = fn(i / sr, i);
      L[from + i] += l;
      R[from + i] += r;
    }
  };

  const kick = (at: number) =>
    add(at, 0.35, (t) => {
      const freq = 45 + 90 * Math.exp(-t * 28);
      const v = Math.sin(2 * Math.PI * (45 * t + (90 / 28) * (1 - Math.exp(-t * 28)))) * Math.exp(-t * 9) * 0.9 + (t < 0.004 ? 0.3 * (1 - t / 0.004) : 0) * (freq > 0 ? 1 : 1);
      return [v, v];
    });
  const snare = (at: number) => {
    let last = 0;
    add(at, 0.22, (t) => {
      const white = noise();
      const hp = white - last;
      last = white;
      const v = hp * 0.32 * Math.exp(-t * 22) + Math.sin(2 * Math.PI * 190 * t) * 0.35 * Math.exp(-t * 30);
      return [v, v];
    });
  };
  const hat = (at: number, level: number, pan: number) => {
    let last = 0;
    add(at, 0.06, (t) => {
      const white = noise();
      const hp = white - last;
      last = white;
      const v = hp * level * Math.exp(-t * 70);
      return [v * (1 - pan), v * (1 + pan)];
    });
  };
  const bass = (at: number, note: number, length: number) =>
    add(at, length, (t) => {
      const f = midi(note);
      const env = Math.min(1, t / 0.008) * Math.exp(-t * 2.2) * Math.min(1, (length - t) / 0.02);
      const v = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * 2 * f * t)) * 0.42 * env;
      return [v, v];
    });
  const keys = (at: number, notes: number[], length: number) =>
    add(at, length, (t) => {
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 1.6) * Math.min(1, (length - t) / 0.05);
      let l = 0, r = 0;
      for (const note of notes) {
        const f = midi(note);
        l += Math.sin(2 * Math.PI * f * 0.998 * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * 0.998 * t) * Math.exp(-t * 4);
        r += Math.sin(2 * Math.PI * f * 1.002 * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * 1.002 * t) * Math.exp(-t * 4);
      }
      const k = (0.11 * env) / Math.sqrt(notes.length / 3);
      return [l * k, r * k];
    });

  // i – i – VI – VII – i – i – VI – V: the major V chord at the end pins the key to F minor.
  const chords: { notes: number[]; root: number }[] = [
    { notes: [53, 56, 60, 63], root: 41 },
    { notes: [53, 56, 60, 63], root: 41 },
    { notes: [49, 53, 56, 60], root: 37 },
    { notes: [51, 55, 58, 61], root: 39 },
    { notes: [53, 56, 60, 63], root: 41 },
    { notes: [53, 56, 60, 65], root: 41 },
    { notes: [49, 53, 56, 60], root: 37 },
    { notes: [48, 52, 55, 58], root: 36 },
  ];
  const swing = beat * 0.06;
  for (let b = 0; b < DEMO.bars; b++) {
    const t0 = b * bar;
    const { notes, root } = chords[b];
    kick(t0);
    kick(t0 + beat * 1.5 + swing);
    kick(t0 + beat * 2);
    if (b % 2 === 1) kick(t0 + beat * 3.5 + swing);
    snare(t0 + beat);
    snare(t0 + beat * 3);
    for (let e = 0; e < 8; e++) hat(t0 + e * (beat / 2) + (e % 2 ? swing : 0), e % 2 ? 0.1 : 0.16, e % 2 ? 0.25 : -0.15);
    bass(t0, root, beat * 1.4);
    bass(t0 + beat * 1.5 + swing, root, beat * 0.45);
    bass(t0 + beat * 2, root, beat * 1.3);
    bass(t0 + beat * 3.5 + swing, root + 12, beat * 0.4);
    keys(t0, notes, beat * 2.4);
    keys(t0 + beat * 2.5 + swing, notes, beat * 1.4);
  }
  const peak = peakOf([L, R]);
  const gain = peak > 0 ? 0.708 / peak : 1; // −3 dBFS
  for (let i = 0; i < n; i++) {
    L[i] *= gain;
    R[i] *= gain;
  }
  return [L, R];
}
