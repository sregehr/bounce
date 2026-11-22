import type { Balance, VoiceStats } from './analysis';
import { clamp } from './core';

export type Band = { type: 'lowshelf' | 'peaking' | 'highshelf'; freq: number; gain: number; q: number };

/** One processing chain, as shown on the Mix page. */
export type Chain = {
  eq: Band[];
  comp: { threshold: number; ratio: number; attack: number; release: number; makeup: number };
  /** `amount` is the most the sibilance can be turned down, in dB. */
  deess: { freq: number; amount: number };
  limiter: { ceiling: number; release: number };
};

export const VOCAL_STYLES = ['Upfront', 'Melodic', 'Dark', 'Gritty'] as const;
export type VocalStyle = (typeof VOCAL_STYLES)[number];

export const MASTER_STYLES = ['Auto', 'Punchy', 'Warm', 'Loud', 'Lo-fi'] as const;
export type MasterStyle = (typeof MASTER_STYLES)[number];

/** How the beat is shaped before it meets the vocal. Auto is nearly transparent. */
export const BEAT_STYLES = ['Auto', 'Tucked', 'Punchy', 'Warm', 'Bright'] as const;
export type BeatStyle = (typeof BEAT_STYLES)[number];

/** `beatStyle` left out is Auto; `beatLevel` left out is the automatic balance, as 68 is for the vocal. */
export type Polish = { style: VocalStyle; double: boolean; vocalLevel: number; beatStyle?: BeatStyle; beatLevel?: number };
/** Where a level slider sits when the balance is the automatic one. */
export const LEVEL_REST = 68;
export type MasterSettings = { style: MasterStyle; amount: number; low: number; mid: number; high: number; comp: number };

export const DEFAULT_POLISH: Polish = { style: 'Upfront', double: false, vocalLevel: 68 };
export const DEFAULT_MASTER: MasterSettings = { style: 'Auto', amount: 70, low: 0, mid: 0, high: 0, comp: 45 };

/** How much reverb and echo one part of the mix gets, each 0–100. */
export type Send = { reverb?: number; echo?: number };
/**
 * Reverb and echo for the vocal, the beat and the whole mix. Anything left out is automatic:
 * the vocal's reverb follows its style, everything else is off.
 */
export type Space = {
  vocal?: Send;
  beat?: Send;
  master?: Send;
  /** How hard the room and bleed between phrases are turned down, 0–100. 50 is the automatic 12 dB. */
  roomCut?: number;
};
export const DEFAULT_ROOM_CUT = 50;
/** The reverb a vocal style comes with, on the same 0–100 scale as the slider. */
export const styleReverb = (style: VocalStyle) => Math.round(vocalExtras(style).reverb * 300);

/** Extras that go with a vocal style but are not part of the editable chain. */
export type VocalExtras = { reverb: number; saturation: number; lift: number };

const round1 = (v: number) => Math.round(v * 10) / 10;

/** A vocal chain fitted to the measured voice, then shaped by the chosen style. */
export function autoVocalChain(stats: VoiceStats, style: VocalStyle): Chain {
  // Mud: how much the lows outweigh the mids compared with a clear voice.
  const mud = clamp(stats.balance.low - stats.balance.mid - 2, 0, 4);
  // Sibilance around −22 dB below the body is typical; more gets more de-essing.
  const harsh = clamp(stats.sibilanceDb + 22, 0, 6);
  const shape = {
    Upfront: { low: -2, mud: -2, presence: 3, air: 2, ratio: 4, attack: 6, release: 110, drop: 7, deess: 5 },
    Melodic: { low: -2, mud: -1.5, presence: 1.5, air: 3.5, ratio: 2.5, attack: 12, release: 160, drop: 5, deess: 6 },
    Dark: { low: 0, mud: -1, presence: 0.5, air: -2.5, ratio: 3, attack: 10, release: 140, drop: 6, deess: 3 },
    Gritty: { low: -3, mud: -1, presence: 4, air: 1, ratio: 6, attack: 3, release: 90, drop: 9, deess: 4 },
  }[style];
  const body = stats.bodyDb > -70 ? stats.bodyDb : -24;
  const threshold = clamp(Math.round(body - shape.drop + 6), -40, -4);
  // Give back roughly what the compressor takes off the body of the voice.
  const makeup = clamp(round1((body - threshold) * (1 - 1 / shape.ratio) * 0.8), 0, 12);
  return {
    eq: [
      { type: 'lowshelf', freq: 90, gain: shape.low, q: 0.7 },
      { type: 'peaking', freq: 350, gain: round1(shape.mud - mud * 0.6), q: 1.4 },
      { type: 'peaking', freq: 3200, gain: shape.presence, q: 0.9 },
      { type: 'highshelf', freq: 10000, gain: shape.air, q: 0.7 },
    ],
    comp: { threshold, ratio: shape.ratio, attack: shape.attack, release: shape.release, makeup },
    deess: { freq: 6500, amount: round1(shape.deess + harsh * 0.5) },
    limiter: { ceiling: -1, release: 80 },
  };
}

export function vocalExtras(style: VocalStyle): VocalExtras {
  return {
    Upfront: { reverb: 0.05, saturation: 0.08, lift: 2 },
    Melodic: { reverb: 0.2, saturation: 0.04, lift: 0.5 },
    Dark: { reverb: 0.14, saturation: 0.18, lift: -0.5 },
    Gritty: { reverb: 0.03, saturation: 0.55, lift: 1.5 },
  }[style];
}

/**
 * The beat's chain: nearly transparent, with a little room carved out when there is a vocal on top.
 * A beat sound other than Auto leans it one way from there.
 */
export function autoBeatChain(beatRmsDb: number, hasVocal: boolean, style: BeatStyle = 'Auto'): Chain {
  // `squeeze` is how far below its usual place the compressor starts, in dB, with that much of the level given back.
  // The moves are large on purpose: the master evens out small ones, so a sound has to lean hard to be heard.
  const shape = {
    Auto: { low: 0, mud: 0, presence: 0, air: 0, ratio: 2, attack: 30, release: 150, squeeze: 0 },
    // Further out of the voice's way: less of the range where the words sit.
    Tucked: { low: 0, mud: -3, presence: -4.5, air: -2, ratio: 2, attack: 30, release: 150, squeeze: 0 },
    // A slower attack lets the drums through before the compressor closes, with more weight underneath.
    Punchy: { low: 4, mud: -1.5, presence: 2.5, air: 1.5, ratio: 4, attack: 60, release: 100, squeeze: 8 },
    Warm: { low: 2.5, mud: 2.5, presence: -2, air: -6, ratio: 2.5, attack: 30, release: 180, squeeze: 3 },
    Bright: { low: -1, mud: -2, presence: 3, air: 6, ratio: 2, attack: 30, release: 150, squeeze: 0 },
  }[style];
  return {
    eq: [
      { type: 'lowshelf', freq: 90, gain: shape.low, q: 0.7 },
      { type: 'peaking', freq: 350, gain: (hasVocal ? -1 : 0) + shape.mud, q: 1.4 },
      { type: 'peaking', freq: 3200, gain: (hasVocal ? -1.5 : 0) + shape.presence, q: 0.9 },
      { type: 'highshelf', freq: 10000, gain: shape.air, q: 0.7 },
    ],
    comp: { threshold: clamp(Math.round(beatRmsDb + 8 - shape.squeeze), -36, -2), ratio: shape.ratio, attack: shape.attack, release: shape.release, makeup: round1(shape.squeeze * (1 - 1 / shape.ratio) * 0.5) },
    deess: { freq: 6500, amount: 0 },
    limiter: { ceiling: -1, release: 80 },
  };
}

export type MasterPlan = {
  chain: Chain;
  /** Loudness the master aims for; null leaves the level alone. */
  targetLufs: number | null;
  saturation: number;
  lofi: boolean;
  /** What the style did, in words, for the Master screen. */
  note: string;
};

/** What a hip-hop mix tends to measure: lows, mids and highs relative to the whole, in dB. */
const REFERENCE: Balance = { low: -3, mid: -3.6, high: -15 };

const moved = (v: number, what: string) => (Math.abs(v) < 0.4 ? `${what} left alone` : `${what} ${v > 0 ? 'up' : 'down'} ${Math.abs(v).toFixed(1).replace(/\.0$/, '')} dB`);

/** Turns the Master screen's choices into a chain, a loudness target and a description. */
export function masterPlan(settings: MasterSettings, mix: { balance: Balance; lufs: number }): MasterPlan {
  const k = clamp(settings.amount, 0, 100) / 100;
  const compK = clamp(settings.comp, 0, 100) / 100;
  let low = 0, lowMid = 0, presence = 0, high = 0;
  let ratio = 1.8, attack = 25, release = 160, depth = 4, saturation = 0, target = -10, lofi = false, note = '';
  switch (settings.style) {
    case 'Auto': {
      low = clamp(REFERENCE.low - mix.balance.low, -3, 3);
      presence = clamp((REFERENCE.mid - mix.balance.mid) * 0.5, -2, 2);
      high = clamp(REFERENCE.high - mix.balance.high, -3, 3);
      note = `Listened to the whole track and matched it to a reference curve: ${moved(low * k, 'lows')}, ${moved(presence * k, 'presence around 3 kHz')}, ${moved(high * k, 'highs')}, with gentle glue compression.`;
      break;
    }
    case 'Punchy':
      low = 2; presence = 0.5; high = 1.5; ratio = 3; attack = 40; release = 120; depth = 5; target = -9.5;
      note = 'Slower compressor attack so drums hit harder, a tight low-end bump, and a touch more top.';
      break;
    case 'Warm':
      lowMid = 1.5; high = -2; ratio = 2; attack = 20; saturation = 0.4; target = -11;
      note = 'Rolled off the very top, added low-mid body, and soft saturation before the limiter.';
      break;
    case 'Loud':
      low = 1; high = 1; ratio = 4; attack = 10; release = 100; depth = 8; saturation = 0.15; target = -7.5;
      note = 'Heavier compression and the limiter pushed hard. Maximum level, less dynamics.';
      break;
    case 'Lo-fi':
      lowMid = 1; presence = -1; ratio = 2.5; saturation = 0.6; target = -12; lofi = true;
      note = 'Narrowed the highs and lows, added tape-style saturation and a little wobble.';
      break;
  }
  // The compression slider leans the style's compressor harder or softer around its default of 45.
  const lean = 0.4 + compK * 1.35;
  const threshold = clamp(Math.round(mix.lufs + 10 - depth * k * lean), -40, -2);
  return {
    chain: {
      eq: [
        { type: 'lowshelf', freq: 100, gain: round1(low * k + settings.low), q: 0.7 },
        { type: 'peaking', freq: 300, gain: round1(lowMid * k), q: 1 },
        { type: 'peaking', freq: 3200, gain: round1(presence * k + settings.mid), q: 0.9 },
        { type: 'highshelf', freq: 9000, gain: round1(high * k + settings.high), q: 0.7 },
      ],
      comp: { threshold, ratio: round1(1 + (ratio - 1) * k * Math.min(1.5, lean)), attack, release, makeup: 0 },
      deess: { freq: 6500, amount: 0 },
      limiter: { ceiling: -1, release: settings.style === 'Loud' ? 50 : 80 },
    },
    // No intensity means no change in level; full intensity reaches the style's target.
    targetLufs: k < 0.02 ? null : mix.lufs + (target - mix.lufs) * Math.min(1, k * 1.25),
    saturation: saturation * k,
    lofi: lofi && k > 0.02,
    note,
  };
}

/** One-line summaries for the Mix page's collapsed sections. */
export function summarise(chain: Chain) {
  const dB = (v: number, d = 0) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(d)} dB`;
  const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')} kHz` : `${Math.round(v)} Hz`);
  return {
    eq: `${chain.eq.length} bands`,
    comp: `${dB(chain.comp.threshold)} · ${chain.comp.ratio.toFixed(1).replace(/\.0$/, '')}:1 · ${Math.round(chain.comp.attack)} ms · ${Math.round(chain.comp.release)} ms`,
    deess: chain.deess.amount > 0 ? `${hz(chain.deess.freq)} · ${dB(-chain.deess.amount)}` : 'Off',
    limiter: `Ceiling ${dB(chain.limiter.ceiling, 1)}`,
  };
}
