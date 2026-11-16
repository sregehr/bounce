import type { VoiceStats } from '@/dsp/analysis';
import type { Chain, MasterSettings, Polish, Space } from '@/dsp/presets';

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

export type ExportChoice = { loudness: 'streaming' | 'loud' | 'mastered'; format: 'wav24' | 'wav16'; instrumental: boolean; vocals: boolean };
export type SnippetChoice = { lengthSec: 15 | 20 | 30; captions: boolean; credit: boolean; caption: string; made: boolean };

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
  exporting: ExportChoice;
  snippet: SnippetChoice;
  cover: Cover;
  lyrics: string;
  /** Who is on the song: the rapper or singer it features. Empty means the name in Settings. */
  artist?: string;
  /** Numbers from the last master, shown in lists without rendering again. */
  stats: { lufs: number; truePeakDb: number; durationSec: number } | null;
  /** Set on a finished song in the Vault: when it was saved, and the beat it was made from. */
  saved?: { at: number; from: string };
};

export type Profile = { artist: string; producer: string; onboarded: boolean };

export type Settings = {
  /** The microphone used for vocals. */
  inputId: string | null;
  /** The input beats are captured from: a sampler, groovebox or audio interface. */
  beatInputId: string | null;
  /** Round-trip delay measured on this device, or null to use what the browser reports. */
  latencyMs: number | null;
  /** Delay measured for each setup, keyed by the microphone and what the beat plays out of. See data/timing. */
  timing?: Record<string, number>;
  backup: boolean;
  /** Identifies this browser to the backup until there are accounts. */
  deviceId: string;
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
};

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function emptyLibrary(): Library {
  return { version: 1, profile: { artist: '', producer: '', onboarded: false }, settings: { inputId: null, beatInputId: null, latencyMs: null, backup: true, deviceId: newId() + newId() }, projects: [], currentId: null, coverPhotoKey: null };
}
