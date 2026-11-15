import type { LatencyResult, TapResult } from '@/dsp/latency';

export type InputDevice = { deviceId: string; label: string };

export type InputState = {
  status: 'idle' | 'opening' | 'ready' | 'error';
  error: string | null;
  inputs: InputDevice[];
  deviceId: string | null;
  label: string;
  /** What the beat plays out of, where the browser says; empty when it does not. */
  output: string;
  sampleRate: number;
  channels: number;
  /** Zero-based stereo pair being captured: 0 is channels 1–2. */
  pair: number;
  levelL: number;
  levelR: number;
};

export type CaptureState = {
  status: 'idle' | 'armed' | 'recording';
  elapsed: number;
  peak: number;
  clipped: boolean;
  /** Linear peak per waveform bar since recording started. */
  wave: number[];
};

export type TransportState = {
  /** Whatever the caller named the thing that is loaded, or null when nothing is. */
  id: string | null;
  playing: boolean;
  position: number;
  duration: number;
  side: 'a' | 'b';
};

export type TakeState = {
  mode: 'idle' | 'listening' | 'recording';
  /** Seconds since the beat started. */
  elapsed: number;
  /** Seconds of input held so far (capped at 60 while listening). */
  held: number;
  level: number;
  clipped: boolean;
  /** True once a beat that plays through once has reached its end. */
  ended: boolean;
};

export type EngineState = { input: InputState; capture: CaptureState; transport: TransportState; take: TakeState };

export type Captured = { channels: [Float32Array, Float32Array]; sampleRate: number; peak: number; clipped: boolean; label: string };

export type RecordedTake = {
  mono: Float32Array;
  sampleRate: number;
  /** How far into the loop the recording starts, in seconds (0 unless kept from listening). */
  phaseSec: number;
  peak: number;
  clipped: boolean;
};

export type PlayOptions = {
  /** Samples and rate for the main side, and optionally a second version to compare against. */
  a: { channels: Float32Array[]; sampleRate: number };
  b?: { channels: Float32Array[]; sampleRate: number };
  side?: 'a' | 'b';
  from?: number;
  loop?: boolean;
  /** Keep the current position and play state, for swapping in a re-rendered version. */
  keepPosition?: boolean;
  autoplay?: boolean;
};

/** A clap-along timing check in progress: when each click plays (on the `performance.now()` clock) and what the mic made of it. */
export type ClapRun = { clicksAt: number[]; result: Promise<TapResult>; stop: () => void };

export type { LatencyResult };
