import type { VoiceStats } from '@/dsp/analysis';
import type { Chain, MasterSettings, Polish, Space, VocalStyle } from '@/dsp/presets';

/** A stored audio file: `key` finds it in the blob store. */
export type AudioInfo = { key: string; durationSec: number; sampleRate: number; channels: number };

export type Beat = AudioInfo & {
  source: 'capture' | 'import' | 'demo';
  sourceLabel: string;
  peakDb: number;
  lufs: number;
  clipped: boolean;
  trimmedSec: number;
  /** Normalised peaks for drawing the waveform. */
  wave: number[];
  /** Silence left before the first sound when the beat was trimmed, so bar one is found exactly. */
  leadSec: number;
  bpm: number | null;
  /** Musical key, such as "F minor". */
  musicalKey: string | null;
};

export type Take = AudioInfo & {
  id: string;
  number: number;
  createdAt: number;
  /** How far into the loop the take starts, in seconds. */
  phaseSec: number;
  /** The loop the take was recorded over, so it always plays back against the same bars. */
  loop: LoopChoice;
  wave: number[];
  peakDb: number;
  clipped: boolean;
  origin: 'recorded' | 'kept' | 'punched';
  voice: VoiceStats | null;
  /** Who was at the mic, when an artist was picked for the session. */
  artistId?: string;
};

/** `bars` 0 means the whole beat, played through once. */
export type LoopChoice = { bars: 0 | 8 | 16; startBar: number };

export const SCENES = ['photo', 'studio', 'stage', 'rooftop'] as const;
export type SceneId = (typeof SCENES)[number];

export type Cover = {
  /** One of the drawn scenes, or 'ai' for a scene made from a description. */
  scene: SceneId | 'ai';
  /** The photo as taken. */
  photoKey: string | null;
  /** The person cut out of the photo, when that worked. */
  cutoutKey: string | null;
  /** The finished cover for the chosen scene. */
  imageKey: string | null;
};

export type ExportChoice = { loudness: 'streaming' | 'loud' | 'mastered'; format: 'wav24' | 'wav16' | 'm4a'; instrumental: boolean; vocals: boolean };
/** `startSec` is where the snippet begins when the user moved it; without one the strongest stretch is used. */
export type SnippetChoice = { lengthSec: 15 | 20 | 30; captions: boolean; credit: boolean; caption: string; made: boolean; startSec?: number | null; shape?: 'tall' | 'square' | 'wide' };

/** One person's part in a song. `share` is their percentage of it. */
export type Credit = { name: string; role: 'Writer' | 'Producer' | 'Performer'; share: number };

/** One more vocal on top of the lead. Level 68 is balanced against the beat, as it is for the lead; pan runs -100 (left) to 100 (right). */
export type Layer = { takeId: string; role: 'double' | 'adlib' | 'hook'; level: number; pan: number };
export const LAYER_START: Record<Layer['role'], { level: number; pan: number }> = { double: { level: 44, pan: -35 }, adlib: { level: 50, pan: 40 }, hook: { level: 60, pan: 0 } };

/** Everything that shapes the sound of a mix: what undo steps through, and what Mix A and Mix B each hold. */
export type MixSettings = { polish: Polish; master: MasterSettings; overrides: { vocal?: Chain; beat?: Chain; master?: Chain }; space?: Space };

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  beat: Beat;
  loop: LoopChoice;
  takes: Take[];
  /** The take that Playback, Master and the Player use. */
  takeId: string | null;
  polish: Polish;
  master: MasterSettings;
  /** Chains edited by hand on the Mix page. */
  overrides: { vocal?: Chain; beat?: Chain; master?: Chain };
  /** Reverb and echo set by hand on the Mix page. */
  space?: Space;
  /** Who wrote, produced and performed the song, and how it is split between them. */
  credits?: Credit[];
  /** Vocals stacked on the picked take: doubles, ad-libs, a hook. */
  layers?: Layer[];
  /** Bars of the picked take that play from another take instead, by bar number from 0. */
  comp?: Record<string, string>;
  /** The other of two mixes being compared, and which of the two is the one in use now. */
  mixAlt?: MixSettings;
  mixSide?: 'A' | 'B';
  exporting: ExportChoice;
  snippet: SnippetChoice;
  cover: Cover;
  lyrics: string;
  /** Who is on the song: the rapper or singer it features. Empty means the name in Settings. */
  artist?: string;
  /** That artist's saved profile, when they have one. Older songs have only the name. */
  artistId?: string;
  /** Numbers from the last master, shown in lists without rendering again. */
  stats: { lufs: number; truePeakDb: number; durationSec: number } | null;
  /** Set on a finished song in the Vault: when it was saved, and the beat it was made from. */
  saved?: { at: number; from: string };
};

export type Profile = { artist: string; producer: string; onboarded: boolean };

/** Someone who records here: their name, and the vocal sound that suits their voice. */
export type Artist = {
  id: string;
  name: string;
  /** Their vocal chain, saved from the Mix page the same way "my preset" is, and the vocal style it was made under. */
  chain?: Chain;
  style?: VocalStyle;
  createdAt: number;
};

export type Settings = {
  /** The microphone used for vocals. */
  inputId: string | null;
  /** The input beats are captured from: a sampler, groovebox or audio interface. */
  beatInputId: string | null;
  /** Round-trip delay measured on this device, or null to use what the browser reports. */
  latencyMs: number | null;
  /** Delay measured for each setup, keyed by the microphone and what the beat plays out of. See data/timing. */
  timing?: Record<string, number>;
  /** One bar of clicks before a take starts recording. On unless turned off. */
  countIn?: boolean;
  backup: boolean;
  /** Says which backup on the server is this device's. */
  deviceId: string;
  /** Proves to the backup server that a request comes from this device. Never shown or shared. */
  deviceSecret: string;
  /** A vocal chain saved from the Mix page. */
  vocalPreset?: Chain;
};

export type Library = {
  version: 1;
  profile: Profile;
  settings: Settings;
  /** Beats being worked on and finished songs together; a finished song has `saved` set. */
  projects: Project[];
  currentId: string | null;
  coverPhotoKey: string | null;
  /** The finished song played last. */
  songId?: string | null;
  /** Set once songs from before the Vault held only finished ones have been carried over. */
  vault?: 1;
  /** The artists recorded here who have a saved profile. */
  artists?: Artist[];
  /** The artist at the mic for this session. New songs and takes are theirs until it is changed. */
  sessionArtistId?: string | null;
};

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** A long random secret, from the system's secure generator where there is one. */
export function newSecret() {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function emptyLibrary(): Library {
  return { version: 1, profile: { artist: '', producer: '', onboarded: false }, settings: { inputId: null, beatInputId: null, latencyMs: null, backup: true, deviceId: newId() + newId(), deviceSecret: newSecret() }, projects: [], currentId: null, coverPhotoKey: null };
}
