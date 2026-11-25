// The native build has no AAC encoder wired up yet; the browser build (aac.web.ts) does.

/** Whether this device can make M4A files at this sample rate and channel count. */
export const aacSupported = async (_sampleRate = 44100, _channels = 2): Promise<boolean> => false;

export async function encodeM4a(_channels: Float32Array[], _sampleRate: number, _bitrate?: number, _tags?: import('./tags').Tags): Promise<ArrayBuffer> {
  throw new Error('M4A files cannot be made on this device yet.');
}
