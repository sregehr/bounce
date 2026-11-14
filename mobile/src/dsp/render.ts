import { measureVoice, tonalBalance, type VoiceStats } from './analysis';
import { clamp, finalise, fromDb, integratedLufs, peakOf, reduceNoise, rmsDb, toDb, truePeakDb, type Stereo } from './core';
import { doubleTrack, highpass, lowpass, reverb, runChain, saturate, wobble } from './effects';
import { autoBeatChain, autoVocalChain, masterPlan, vocalExtras, type Chain, type MasterPlan, type MasterSettings, type Polish } from './presets';

export type RenderInput = {
  sampleRate: number;
  /** The beat, one or two channels. */
  beat: Float32Array[];
  /** Loop region in frames, or null to play the beat through once. */
  loop: { start: number; end: number } | null;
  /** The vocal, already lined up with the beat. `phase` is how far into the loop it starts, in frames. */
  take: { mono: Float32Array; phase: number } | null;
  polish: Polish;
  master: MasterSettings;
  /** Chains the user has edited by hand; anything missing is worked out automatically. */
  overrides?: { vocal?: Chain; beat?: Chain; master?: Chain };
  include?: 'mix' | 'instrumental' | 'vocals';
  /** Frames in one bar, when the tempo is known, so the song ends on a bar line. */
  barFrames?: number;
  /** Replaces the master style's loudness target (used by Export). */
  targetLufs?: number | null;
  /** Saved measurements of the take, to skip measuring it again. */
  voice?: VoiceStats;
};

export type RenderOutput = {
  channels: Stereo;
  sampleRate: number;
  durationSec: number;
  lufs: number;
  truePeakDb: number;
  /** The chains that were actually used, for the Advanced screen. */
  chains: { vocal: Chain | null; beat: Chain; master: Chain };
  note: string;
  voice: VoiceStats | null;
  did: { noiseReduced: boolean; vocalGainDb: number; limiterDb: number };
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** How long the song runs, in frames. */
export function songLength(input: Pick<RenderInput, 'beat' | 'loop' | 'take' | 'barFrames' | 'sampleRate'>): number {
  const beatLength = input.beat[0]?.length ?? 0;
  if (!input.take || !input.loop) return beatLength;
  const bar = input.barFrames && input.barFrames > 0 ? input.barFrames : Math.round(input.sampleRate * 0.5);
  // Run to the end of the bar the vocal finishes in, and never less than one bar.
  return Math.max(1, Math.ceil(input.take.mono.length / bar)) * bar;
}

/** Lays the beat out for the length of the song: once through, or the loop region repeated. */
export function arrangeBeat(input: Pick<RenderInput, 'beat' | 'loop' | 'take' | 'barFrames' | 'sampleRate'>): Stereo {
  const length = songLength(input);
  const left = input.beat[0];
  const right = input.beat[1] ?? input.beat[0];
  const L = new Float32Array(length), R = new Float32Array(length);
  if (!input.take || !input.loop) {
    L.set(left.subarray(0, length));
    R.set(right.subarray(0, length));
    return [L, R];
  }
  const start = clamp(input.loop.start, 0, left.length - 1);
  const end = clamp(input.loop.end, start + 1, left.length);
  const span = end - start;
  const fade = Math.min(Math.round(input.sampleRate * 0.002), Math.floor(span / 4));
  const phase = ((input.take.phase % span) + span) % span;
  for (let i = 0; i < length; i++) {
    const at = (i + phase) % span;
    // A two-millisecond dip at the seam avoids a click where the loop wraps.
    const edge = at < fade ? at / fade : at >= span - fade ? (span - at) / fade : 1;
    L[i] = left[start + at] * edge;
    R[i] = right[start + at] * edge;
  }
  fadeOut([L, R], Math.round(input.sampleRate * 0.06));
  return [L, R];
}

function fadeOut(channels: Float32Array[], frames: number) {
  for (const ch of channels) {
    const n = Math.min(frames, ch.length);
    for (let i = 0; i < n; i++) ch[ch.length - n + i] *= 1 - i / n;
  }
}

function fitted(x: Float32Array, length: number): Float32Array {
  if (x.length === length) return x.slice();
  const out = new Float32Array(length);
  out.set(x.subarray(0, Math.min(length, x.length)));
  return out;
}

function addInto(target: Stereo, source: [Float32Array, Float32Array], gain = 1) {
  const n = Math.min(target[0].length, source[0].length);
  for (let i = 0; i < n; i++) {
    target[0][i] += source[0][i] * gain;
    target[1][i] += source[1][i] * gain;
  }
}

/** The take over the beat with nothing done to either, for the "Raw take" side of the comparison. */
export function renderRaw(input: RenderInput): Stereo {
  const mix = arrangeBeat(input);
  if (input.take) {
    const vocal = fitted(input.take.mono, mix[0].length);
    addInto(mix, [vocal, vocal]);
  }
  const peak = peakOf(mix);
  if (peak > 0.98) {
    const g = 0.98 / peak;
    for (const ch of mix) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  }
  return mix;
}

/** The polished, mastered song. */
export async function renderMix(input: RenderInput, onStage?: (stage: string) => void): Promise<RenderOutput> {
  const sr = input.sampleRate;
  const include = input.include ?? 'mix';
  onStage?.('Laying out the beat');
  const beat = arrangeBeat(input);
  const length = beat[0].length;
  await tick();

  // ----- Vocal -----
  let vocalBus: Stereo | null = null;
  let vocalChain: Chain | null = null;
  let voice: VoiceStats | null = null;
  let noiseReduced = false;
  let vocalGainDb = 0;
  if (input.take && include !== 'instrumental') {
    onStage?.('Cleaning up the take');
    const dry = [fitted(input.take.mono, length)];
    highpass(dry, sr, 80);
    noiseReduced = reduceNoise(dry, sr) > -170;
    await tick();
    voice = input.voice ?? measureVoice(dry, sr);
    vocalChain = input.overrides?.vocal ?? autoVocalChain(voice, input.polish.style);
    onStage?.('Fitting the chain to your voice');
    const extras = vocalExtras(input.polish.style);
    runChain(dry, sr, vocalChain);
    saturate(dry, extras.saturation);
    await tick();
    const mono = dry[0];
    vocalBus = [mono.slice(), mono.slice()];
    if (input.polish.double) addInto(vocalBus, doubleTrack(mono, sr));
    if (extras.reverb > 0.01) addInto(vocalBus, reverb(mono, sr), extras.reverb * 3);
    await tick();
  }

  // ----- Beat -----
  onStage?.('Balancing the beat');
  const beatChain = input.overrides?.beat ?? autoBeatChain(rmsDb(beat), !!vocalBus);
  const beatBus: Float32Array[] = [beat[0], beat[1]];
  runChain(beatBus, sr, beatChain);
  await tick();

  if (vocalBus) {
    // Sit the voice a little above the beat, then apply the vocal level slider.
    const body = measureVoice([vocalBus[0]], sr).bodyDb;
    const beatLevel = rmsDb(beatBus);
    const lift = vocalExtras(input.polish.style).lift;
    vocalGainDb = body > -70 ? clamp(beatLevel + 3 + lift - body + (input.polish.vocalLevel - 68) * 0.25, -24, 24) : 0;
    const g = fromDb(vocalGainDb);
    for (const ch of vocalBus) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  }

  // ----- Mix -----
  const full: Stereo = [beatBus[0].slice(), beatBus[1].slice()];
  if (vocalBus) addInto(full, vocalBus);
  const measured = { balance: tonalBalance(full, sr), lufs: integratedLufs(full, sr) };
  const plan: MasterPlan = masterPlan(input.master, measured);
  const masterChain = input.overrides?.master ?? plan.chain;
  await tick();

  let out: Float32Array[];
  if (include === 'vocals') out = vocalBus ? [vocalBus[0], vocalBus[1]] : [new Float32Array(length), new Float32Array(length)];
  else if (include === 'instrumental') out = [beatBus[0], beatBus[1]];
  else out = [full[0], full[1]];

  // ----- Master -----
  onStage?.('Mastering');
  let limiterDb = 0;
  let result = { lufs: -70, truePeakDb: -180 };
  if (include === 'vocals') {
    // A stem for an engineer: keep it clean, just make sure it cannot clip.
    const peak = peakOf(out);
    if (peak > 0.89) for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] *= 0.89 / peak;
    result = { lufs: integratedLufs(out, sr), truePeakDb: truePeakDb(out) };
  } else {
    // The master's own limiter runs last, inside finalise, so only the EQ and compressor run here.
    runChain(out, sr, { ...masterChain, limiter: { ceiling: 0, release: masterChain.limiter.release } });
    saturate(out, plan.saturation);
    if (plan.lofi) {
      highpass(out, sr, 110);
      lowpass(out, sr, 5200);
      wobble(out, sr);
    }
    await tick();
    const target = input.targetLufs !== undefined ? input.targetLufs : plan.targetLufs;
    const done = finalise(out, sr, target, masterChain.limiter.ceiling, masterChain.limiter.release);
    limiterDb = done.reductionDb;
    result = done;
  }

  return {
    channels: [out[0], out[1]],
    sampleRate: sr,
    durationSec: length / sr,
    lufs: result.lufs,
    truePeakDb: result.truePeakDb,
    chains: { vocal: vocalChain, beat: beatChain, master: masterChain },
    note: plan.note,
    voice,
    did: { noiseReduced, vocalGainDb, limiterDb },
  };
}

/** Peak level of a mix in dB, for callers that only hold channels. */
export const peakDb = (channels: Float32Array[]) => toDb(peakOf(channels));
