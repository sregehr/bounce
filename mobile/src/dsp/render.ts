import { measureVoice, tonalBalance, type VoiceStats } from './analysis';
import { clamp, finaliseGently, fromDb, integratedLufs, peakOf, reduceNoise, rmsDb, toDb, truePeakDb, type Stereo } from './core';
import { doubleTrack, echo, highpass, lowpass, reverb, runChain, saturate, wobble } from './effects';
import { autoBeatChain, autoVocalChain, DEFAULT_ROOM_CUT, masterPlan, styleReverb, vocalExtras, type Chain, type MasterPlan, type MasterSettings, type Polish, type Send, type Space } from './presets';

export type RenderInput = {
  sampleRate: number;
  /** The beat, one or two channels. */
  beat: Float32Array[];
  /** Loop region in frames, or null to play the beat through once. */
  loop: { start: number; end: number } | null;
  /** The vocal, already lined up with the beat. `phase` is how far into the loop it starts, in frames. */
  take: { mono: Float32Array; phase: number } | null;
  /**
   * More vocals stacked on the lead: doubles, ad-libs, a hook. Each is lined up like the lead,
   * with its own level (68 is balanced against the beat, as for the lead) and pan (-100 left to 100 right).
   */
  layers?: { mono: Float32Array; level: number; pan: number }[];
  polish: Polish;
  master: MasterSettings;
  /** Chains the user has edited by hand; anything missing is worked out automatically. */
  overrides?: { vocal?: Chain; beat?: Chain; master?: Chain };
  /** Reverb and echo set by hand; anything missing is automatic. */
  space?: Space;
  include?: 'mix' | 'instrumental' | 'vocals';
  /** Frames in one bar, when the tempo is known, so the song ends on a bar line. */
  barFrames?: number;
  /** Replaces the master style's loudness target (used by Export). */
  targetLufs?: number | null;
  /** Saved measurements of the take, to skip measuring it again. */
  voice?: VoiceStats;
  /**
   * Names for the vocal and beat stages' inputs. When a cache is passed and a name matches
   * the last render, that stage's result is reused, so changing only the master is quick.
   */
  stageKeys?: { vocal: string; beat: string };
};

type VocalStage = { bus: Stereo; chain: Chain; voice: VoiceStats; noiseReduced: boolean; body: number; layers: { bus: Stereo; body: number; level: number; pan: number }[] };
type BeatStage = { bus: Stereo; chain: Chain; level: number };
export type StageCache = { vocalKey?: string; vocal?: VocalStage; beatKey?: string; beat?: BeatStage };

export type RenderOutput = {
  channels: Stereo;
  sampleRate: number;
  durationSec: number;
  lufs: number;
  truePeakDb: number;
  /** The chains that were actually used, for the Mix page. */
  chains: { vocal: Chain | null; beat: Chain; master: Chain };
  note: string;
  voice: VoiceStats | null;
  did: { noiseReduced: boolean; vocalGainDb: number; limiterDb: number };
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** How long the song runs, in frames. */
export function songLength(input: Pick<RenderInput, 'beat' | 'loop' | 'take' | 'layers' | 'barFrames' | 'sampleRate'>): number {
  const beatLength = input.beat[0]?.length ?? 0;
  if (!input.take || !input.loop) return beatLength;
  const bar = input.barFrames && input.barFrames > 0 ? input.barFrames : Math.round(input.sampleRate * 0.5);
  // Run to the end of the bar the longest vocal finishes in, and never less than one bar.
  const longest = Math.max(input.take.mono.length, ...(input.layers ?? []).map((l) => l.mono.length));
  return Math.max(1, Math.ceil(longest / bar)) * bar;
}

/** Lays the beat out for the length of the song: once through, or the loop region repeated. */
export function arrangeBeat(input: Pick<RenderInput, 'beat' | 'loop' | 'take' | 'layers' | 'barFrames' | 'sampleRate'>): Stereo {
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

/** The echo repeats on the eighth note when the tempo is known, and about a fifth of a second apart otherwise. */
const echoFrames = (input: Pick<RenderInput, 'barFrames' | 'sampleRate'>) =>
  clamp(input.barFrames && input.barFrames > 0 ? input.barFrames / 8 : input.sampleRate * 0.22, input.sampleRate * 0.09, input.sampleRate * 0.5);

/**
 * Adds reverb and echo to a bus, in place. `source` is what feeds them; a full-range bus sends
 * only what is above the bass, so the low end stays tight.
 */
function addSpace(bus: Stereo, source: Float32Array, send: Send | undefined, input: Pick<RenderInput, 'barFrames' | 'sampleRate'>, fullRange: boolean) {
  const wet = clamp(send?.reverb ?? 0, 0, 100) / 100;
  const repeats = clamp(send?.echo ?? 0, 0, 100) / 100;
  if (wet <= 0 && repeats <= 0) return;
  let feed = source;
  if (fullRange) {
    const cut = [source.slice()];
    highpass(cut, input.sampleRate, 220);
    feed = cut[0];
  }
  if (wet > 0) addInto(bus, reverb(feed, input.sampleRate), wet);
  if (repeats > 0) addInto(bus, echo(feed, input.sampleRate, echoFrames(input)), repeats * 0.7);
}

const monoOf = (bus: Stereo) => {
  const out = new Float32Array(bus[0].length);
  for (let i = 0; i < out.length; i++) out[i] = (bus[0][i] + bus[1][i]) * 0.5;
  return out;
};

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
export async function renderMix(input: RenderInput, onStage?: (stage: string) => void, cache?: StageCache): Promise<RenderOutput> {
  const sr = input.sampleRate;
  const include = input.include ?? 'mix';
  const keys = cache ? input.stageKeys : undefined;
  const length = songLength(input);

  // ----- Vocal -----
  let vocal: VocalStage | null = null;
  if (input.take && include !== 'instrumental') {
    if (keys && cache?.vocalKey === keys.vocal && cache.vocal) {
      vocal = cache.vocal;
    } else {
      onStage?.('Cleaning up the take');
      const dry = [fitted(input.take.mono, length)];
      highpass(dry, sr, 80);
      const roomCut = clamp(input.space?.roomCut ?? DEFAULT_ROOM_CUT, 0, 100);
      const noiseReduced = roomCut > 0 && reduceNoise(dry, sr, (24 * roomCut) / 100) > -170;
      await tick();
      const voice = input.voice ?? measureVoice(dry, sr);
      const chain = input.overrides?.vocal ?? autoVocalChain(voice, input.polish.style);
      onStage?.('Fitting the chain to your voice');
      const extras = vocalExtras(input.polish.style);
      runChain(dry, sr, chain);
      saturate(dry, extras.saturation);
      await tick();
      const mono = dry[0];
      const bus: Stereo = [mono.slice(), mono.slice()];
      if (input.polish.double) addInto(bus, doubleTrack(mono, sr));
      // The style sets the reverb unless it has been set by hand; echo is only ever added by hand.
      addSpace(bus, mono, { reverb: input.space?.vocal?.reverb ?? styleReverb(input.polish.style), echo: input.space?.vocal?.echo }, input, false);
      // Layers get the lead's clean-up and chain, so the stack sounds like one voice, but no
      // double of their own: they are the doubles.
      const layers: VocalStage['layers'] = [];
      for (const layer of input.layers ?? []) {
        onStage?.('Stacking the layers');
        const part = [fitted(layer.mono, length)];
        highpass(part, sr, 80);
        if (roomCut > 0) reduceNoise(part, sr, (24 * roomCut) / 100);
        runChain(part, sr, chain);
        saturate(part, extras.saturation);
        const wet: Stereo = [part[0].slice(), part[0].slice()];
        addSpace(wet, part[0], { reverb: input.space?.vocal?.reverb ?? styleReverb(input.polish.style), echo: input.space?.vocal?.echo }, input, false);
        layers.push({ bus: wet, body: measureVoice([wet[0]], sr).bodyDb, level: layer.level, pan: layer.pan });
        await tick();
      }
      vocal = { bus, chain, voice, noiseReduced, body: measureVoice([bus[0]], sr).bodyDb, layers };
      if (cache && keys) {
        cache.vocalKey = keys.vocal;
        cache.vocal = vocal;
      }
      await tick();
    }
  }

  // ----- Beat -----
  let beatStage: BeatStage;
  if (keys && cache?.beatKey === keys.beat && cache.beat) {
    beatStage = cache.beat;
  } else {
    onStage?.('Balancing the beat');
    const beat = arrangeBeat(input);
    const chain = input.overrides?.beat ?? autoBeatChain(rmsDb(beat), !!input.take);
    const bus: Float32Array[] = [beat[0], beat[1]];
    runChain(bus, sr, chain);
    addSpace([bus[0], bus[1]], monoOf([bus[0], bus[1]]), input.space?.beat, input, true);
    beatStage = { bus: [bus[0], bus[1]], chain, level: rmsDb(bus) };
    if (cache && keys) {
      cache.beatKey = keys.beat;
      cache.beat = beatStage;
    }
    await tick();
  }
  const beatBus = beatStage.bus;
  const beatChain = beatStage.chain;

  // Sit the voice a little above the beat. The automatic balance is limited on its own, so that a
  // quiet take that needs all of that lift still leaves the slider its full travel.
  let vocalGainDb = 0;
  if (vocal && vocal.body > -70) vocalGainDb = clamp(beatStage.level + 3 + vocalExtras(input.polish.style).lift - vocal.body, -24, 24);
  // Then the vocal level slider, shaped like a fader: 68 is the automatic balance, 100 is about
  // 7 dB above it, half way down is 12 dB below, and the bottom is silence.
  const level = clamp(input.polish.vocalLevel, 0, 100);
  vocalGainDb = level > 0 ? vocalGainDb + 40 * Math.log10(level / 68) : -120;
  const vocalGain = level > 0 ? fromDb(vocalGainDb) : 0;

  // ----- Mix -----
  // The stages above may be shared with later renders, so everything from here works on copies.
  const full: Stereo = [beatBus[0].slice(), beatBus[1].slice()];
  // Each layer is balanced against the beat the way the lead is, set by its own level, and
  // placed left or right at equal power. The lead's level slider does not move them.
  const stack: Stereo = [new Float32Array(length), new Float32Array(length)];
  if (vocal) addInto(stack, vocal.bus, vocalGain);
  for (const layer of vocal?.layers ?? []) {
    const at = clamp(layer.level, 0, 100);
    if (at <= 0 || layer.body <= -70) continue;
    const gain = fromDb(clamp(beatStage.level + 3 + vocalExtras(input.polish.style).lift - layer.body, -24, 24) + 40 * Math.log10(at / 68));
    const angle = ((clamp(layer.pan, -100, 100) + 100) / 200) * (Math.PI / 2);
    const left = gain * Math.cos(angle) * Math.SQRT2, right = gain * Math.sin(angle) * Math.SQRT2;
    for (let i = 0; i < length; i++) {
      stack[0][i] += layer.bus[0][i] * left;
      stack[1][i] += layer.bus[1][i] * right;
    }
  }
  if (vocal) addInto(full, stack);
  addSpace(full, monoOf(full), input.space?.master, input, true);
  const measured = { balance: tonalBalance(full, sr), lufs: integratedLufs(full, sr) };
  const plan: MasterPlan = masterPlan(input.master, measured);
  const masterChain = input.overrides?.master ?? plan.chain;
  await tick();

  let out: Float32Array[];
  if (include === 'vocals') {
    out = [new Float32Array(length), new Float32Array(length)];
    if (vocal) addInto(out as Stereo, stack);
  } else if (include === 'instrumental') {
    out = [beatBus[0].slice(), beatBus[1].slice()];
    addSpace(out as Stereo, monoOf(out as Stereo), input.space?.master, input, true);
  }
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
    const done = await finaliseGently(out, sr, target, masterChain.limiter.ceiling, masterChain.limiter.release, tick);
    limiterDb = done.reductionDb;
    result = done;
  }

  return {
    channels: [out[0], out[1]],
    sampleRate: sr,
    durationSec: length / sr,
    lufs: result.lufs,
    truePeakDb: result.truePeakDb,
    chains: { vocal: vocal?.chain ?? null, beat: beatChain, master: masterChain },
    note: plan.note,
    voice: vocal?.voice ?? null,
    did: { noiseReduced: !!vocal?.noiseReduced, vocalGainDb, limiterDb },
  };
}

/** Peak level of a mix in dB, for callers that only hold channels. */
export const peakDb = (channels: Float32Array[]) => toDb(peakOf(channels));
