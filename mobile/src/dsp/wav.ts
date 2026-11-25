import { wavTags, type Tags } from './tags';

/** Encodes float channels as a PCM WAV file. Tags, when given, follow the audio, so the audio starts where every reader expects it. */
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 16 | 24 = 24, tags?: Tags): ArrayBuffer {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytes = bits / 8;
  const dataSize = frames * count * bytes;
  const info = tags ? wavTags(tags) : null;
  // A chunk starts on an even byte, so audio of an odd length is followed by one byte of padding.
  const tail = info ? (dataSize % 2) + info.length : 0;
  const buffer = new ArrayBuffer(44 + dataSize + tail);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize + tail, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * bytes, true);
  view.setUint16(32, count * bytes, true);
  view.setUint16(34, bits, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  let at = 44;
  const scale = bits === 24 ? 8388607 : 32767;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      const n = Math.round(v * scale);
      if (bits === 24) {
        view.setUint8(at, n & 0xff);
        view.setUint8(at + 1, (n >> 8) & 0xff);
        view.setUint8(at + 2, (n >> 16) & 0xff);
      } else {
        view.setInt16(at, n, true);
      }
      at += bytes;
    }
  }
  if (info) new Uint8Array(buffer).set(info, 44 + dataSize + (dataSize % 2));
  return buffer;
}

export type Pcm = { channels: Float32Array[]; sampleRate: number };

/** Reads a PCM WAV file (16, 24 or 32-bit integer, or 32-bit float). Returns null for anything else. */
export function parseWav(buffer: ArrayBuffer): Pcm | null {
  const view = new DataView(buffer);
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (buffer.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let at = 12;
  let format = 0, count = 0, sampleRate = 0, bits = 0;
  while (at + 8 <= buffer.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      count = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // Extensible format: the real format code is in the sub-format field.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === 'data') {
      if (!count || !sampleRate || (format !== 1 && format !== 3)) return null;
      const bytes = bits / 8;
      const frames = Math.floor(Math.min(size, buffer.byteLength - body) / (bytes * count));
      const channels = Array.from({ length: count }, () => new Float32Array(frames));
      let p = body;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < count; c++) {
          let v = 0;
          if (format === 3 && bits === 32) v = view.getFloat32(p, true);
          else if (bits === 16) v = view.getInt16(p, true) / 32768;
          else if (bits === 24) v = ((view.getInt8(p + 2) << 16) | (view.getUint8(p + 1) << 8) | view.getUint8(p)) / 8388608;
          else if (bits === 32) v = view.getInt32(p, true) / 2147483648;
          else return null;
          channels[c][i] = v;
          p += bytes;
        }
      }
      return { channels, sampleRate };
    }
    at = body + size + (size % 2);
  }
  return null;
}
