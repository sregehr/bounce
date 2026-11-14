// The phone build's engine goes here: the same functions as engine.web.ts, backed by the
// native audio module. Until that is wired up, these stand-ins keep the app compiling.
import type { LatencyResult } from '@/dsp/latency';

import type { Captured, EngineState, PlayOptions, RecordedTake } from './types';

const state: EngineState = {
  input: { status: 'error', error: 'Recording on the phone app is not connected yet.', inputs: [], deviceId: null, label: '', sampleRate: 0, channels: 0, pair: 0, levelL: 0, levelR: 0 },
  capture: { status: 'idle', elapsed: 0, peak: 0, clipped: false, wave: [] },
  transport: { id: null, playing: false, position: 0, duration: 0, side: 'a' },
  take: { mode: 'idle', elapsed: 0, held: 0, level: 0, clipped: false, ended: false },
};
const missing = () => Promise.reject(new Error('Audio on the phone app is not connected yet.'));

export const useEngine = <T,>(pick: (s: EngineState) => T): T => pick(state);
export const engineState = () => state;
export const wake = () => {};
export const inputAllowed = async () => false;
export const openInput = async (_deviceId?: string | null, _prefer?: 'mpc' | 'mic') => {};
export const takeSalvaged = (): Captured | null => null;
export const closeInput = (_quiet?: boolean) => {};
export const setPair = (_pair: number) => {};
export const armCapture = () => {};
export const startCaptureNow = () => {};
export const stopCapture = (): Captured | null => null;
export const cancelCapture = () => {};
export const play = (_id: string, _options: PlayOptions): Promise<void> => missing();
export const pause = () => {};
export const resume = async () => {};
export const toggle = () => {};
export const seek = (_seconds: number) => {};
export const setSide = (_side: 'a' | 'b') => {};
export const stopTransport = () => {};
export const spectrum = (bars: number): number[] => new Array(bars).fill(0);
export const startTake = (_mode: 'listening' | 'recording', _beat: { channels: Float32Array[]; sampleRate: number }, _loop: { start: number; end: number } | null): Promise<void> => missing();
export const stopTake = (_keep?: boolean): RecordedTake | null => null;
export const reportedLatencyMs = () => 30;
export const measureLatency = (): Promise<LatencyResult> => missing();
export const decode = (_data: ArrayBuffer): Promise<{ channels: Float32Array[]; sampleRate: number }> => missing();
export const supported = false;
