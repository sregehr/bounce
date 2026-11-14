import { NativeModule, requireNativeModule } from 'expo';

import { AudioStatus, BounceAudioModuleEvents, LatencyResult, Recording } from './BounceAudio.types';

declare class BounceAudioModule extends NativeModule<BounceAudioModuleEvents> {
  requestPermission(): Promise<boolean>;
  configure(sampleRate: number, bufferFrames: number): Promise<AudioStatus>;
  getStatus(): Promise<AudioStatus>;
  /** Picks which hardware input channel recording starts at (0-based). */
  setFirstInputChannel(index: number): Promise<AudioStatus>;
  startCapture(): Promise<void>;
  /** Ends a capture or an overdub and returns the file that was written. */
  stopRecording(): Promise<Recording>;
  startLoop(uri: string): Promise<void>;
  startOverdub(loopUri: string): Promise<void>;
  playMix(loopUri: string, takeUri: string, compensationMs: number): Promise<void>;
  stop(): Promise<void>;
  measureLatency(): Promise<LatencyResult>;
}

export default requireNativeModule<BounceAudioModule>('BounceAudio');
