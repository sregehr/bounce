export type AudioPort = { name: string; type: string; channels: number };

export type AudioStatus = {
  inputs: AudioPort[];
  outputs: AudioPort[];
  sampleRate: number;
  ioBufferFrames: number;
  ioBufferMs: number;
  inputLatencyMs: number;
  outputLatencyMs: number;
  inputChannels: number;
  maxInputChannels: number;
  outputChannels: number;
  /** Channels the input device really delivers; can exceed inputChannels on large interfaces. */
  hardwareInputChannels: number;
  firstInputChannel: number;
  engineRunning: boolean;
};

export type Recording = {
  uri: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  peakDb: number;
  clipped: boolean;
  /** How late the recording started relative to the loop. Should be 0. */
  lateMs: number;
};

export type LatencyResult = {
  detected: number;
  clicks: number;
  valuesMs: number[];
  noiseFloorDb: number;
  /** What the system claims: input + output latency plus two IO buffers. */
  reportedMs: number;
  medianMs?: number;
  minMs?: number;
  maxMs?: number;
};

export type MeterEvent = { peaksDb: number[]; clipped: boolean; seconds: number };

export type BounceAudioModuleEvents = {
  onMeter: (event: MeterEvent) => void;
  onRouteChange: (status: AudioStatus) => void;
};
