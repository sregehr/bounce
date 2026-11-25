// M4A files: AAC audio from the browser's own encoder (WebCodecs), wrapped in an MP4 container
// written here. A tenth the size of a WAV, and every phone and messaging app plays it.

import { m4aTags, type Tags } from './tags';

const CODEC = 'mp4a.40.2'; // AAC-LC
const FRAME = 1024; // samples in every AAC frame
const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Whether this browser can make M4A files at this sample rate and channel count. */
export async function aacSupported(sampleRate = 44100, channels = 2): Promise<boolean> {
  try {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
    if (!RATES.includes(sampleRate) || sampleRate > 65535 || channels < 1 || channels > 2) return false;
    return !!(await AudioEncoder.isConfigSupported({ codec: CODEC, sampleRate, numberOfChannels: channels, bitrate: 256_000 })).supported;
  } catch {
    return false;
  }
}

/** Encodes audio as AAC and returns a complete M4A file, carrying the tags it is given. */
export async function encodeM4a(channels: Float32Array[], sampleRate: number, bitrate = 256_000, tags?: Tags): Promise<ArrayBuffer> {
  const count = Math.min(2, channels.length);
  const length = channels[0]?.length ?? 0;
  if (!count || !length || !(await aacSupported(sampleRate, count))) throw new Error('This browser cannot make M4A files. Pick WAV instead.');

  const frames: Uint8Array[] = [];
  let config: Uint8Array | null = null;
  let failed: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      frames.push(bytes);
      const described = meta?.decoderConfig?.description;
      if (described && !config) config = specificConfig(ArrayBuffer.isView(described) ? new Uint8Array(described.buffer, described.byteOffset, described.byteLength).slice() : new Uint8Array(described).slice());
    },
    error: (e) => void (failed = e),
  });
  encoder.configure({ codec: CODEC, sampleRate, numberOfChannels: count, bitrate: count === 1 ? Math.round(bitrate / 2) : bitrate });

  // Fed a second at a time, pausing whenever the encoder has a backlog, so a long song neither
  // fills memory nor freezes the page.
  for (let at = 0; at < length && !failed; at += sampleRate) {
    const n = Math.min(sampleRate, length - at);
    const planar = new Float32Array(n * count);
    for (let c = 0; c < count; c++) planar.set(channels[c].subarray(at, at + n), c * n);
    const data = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: count, timestamp: Math.round((at / sampleRate) * 1e6), data: planar });
    encoder.encode(data);
    data.close();
    while (encoder.encodeQueueSize > 4 && !failed) await new Promise((r) => setTimeout(r, 4));
  }
  if (!failed) await encoder.flush();
  if (encoder.state !== 'closed') encoder.close();
  if (failed || frames.length === 0) throw new Error('The M4A file could not be made. Pick WAV instead.');

  return mux(frames, config ?? audioConfig(sampleRate, count), sampleRate, count, bitrate, tags ? m4aTags(tags) : null);
}

/** The two bytes that tell a decoder this is AAC-LC at this rate and channel count, for an encoder that does not supply them. */
function audioConfig(sampleRate: number, channels: number) {
  const rate = RATES.indexOf(sampleRate);
  return new Uint8Array([(2 << 3) | (rate >> 1), ((rate & 1) << 7) | (channels << 3)]);
}

/**
 * The decoder's settings as an encoder describes them. Chrome gives the two bytes themselves; Safari
 * gives the whole descriptor an MP4 keeps them in, and they are taken out of it here, since the
 * container below writes that descriptor itself. Wrapped twice, the file plays nowhere.
 */
function specificConfig(described: Uint8Array): Uint8Array {
  // One descriptor: a tag, a length of one to four bytes, then what it holds.
  const read = (at: number) => {
    let size = 0;
    let next = at + 1;
    for (let i = 0; i < 4 && next < described.length; i++) {
      const byte = described[next++];
      size = (size << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) break;
    }
    return { tag: described[at], body: next, end: Math.min(described.length, next + size) };
  };
  if (described[0] !== 0x03) return described;
  const es = read(0);
  // Past the stream's id and flags, and whatever the flags say follows them.
  const flags = described[es.body + 2] ?? 0;
  let at = es.body + 3 + (flags & 0x80 ? 2 : 0) + (flags & 0x40 ? 1 + (described[es.body + 3 + (flags & 0x80 ? 2 : 0)] ?? 0) : 0) + (flags & 0x20 ? 2 : 0);
  while (at < es.end) {
    const part = read(at);
    if (part.tag === 0x04) {
      // The decoder's settings follow thirteen bytes of type, buffer size and bitrates.
      for (let inner = part.body + 13; inner < part.end; ) {
        const found = read(inner);
        if (found.tag === 0x05) return described.slice(found.body, found.end);
        inner = found.end;
      }
    }
    at = part.end;
  }
  return described;
}

// ---------- MP4 container ----------

type Part = Uint8Array | number[];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const zeros = (n: number) => new Array<number>(n).fill(0);

function join(parts: Part[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** One box: its length, its four-letter name, then what it holds. */
function box(name: string, ...parts: Part[]) {
  const body = join(parts);
  return join([u32(body.length + 8), text(name), body]);
}

/** One descriptor inside `esds`: a tag, a length, then what it holds. */
const descriptor = (tag: number, ...parts: Part[]) => {
  const body = join(parts);
  return join([[tag, 0x80, 0x80, 0x80, body.length], body]);
};

const MATRIX = [...u32(0x10000), ...zeros(12), ...u32(0x10000), ...zeros(12), ...u32(0x40000000)];

function mux(frames: Uint8Array[], config: Uint8Array, sampleRate: number, channels: number, bitrate: number, tags: Uint8Array | null): ArrayBuffer {
  const duration = frames.length * FRAME;
  const size = frames.reduce((n, f) => n + f.length, 0);

  const esds = box(
    'esds',
    u32(0),
    descriptor(0x03, u16(1), [0], descriptor(0x04, [0x40, 0x15], [0, 0, 0], u32(bitrate), u32(bitrate), descriptor(0x05, config)), descriptor(0x06, [2])),
  );
  const mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(channels), u16(16), zeros(4), u32(sampleRate * 65536), esds);
  const table = (offset: number) =>
    box(
      'stbl',
      box('stsd', u32(0), u32(1), mp4a),
      box('stts', u32(0), u32(1), u32(frames.length), u32(FRAME)),
      // All the audio sits in one run, straight after the header.
      box('stsc', u32(0), u32(1), u32(1), u32(frames.length), u32(1)),
      box('stsz', u32(0), u32(0), u32(frames.length), frames.flatMap((f) => u32(f.length))),
      box('stco', u32(0), u32(1), u32(offset)),
    );
  const movie = (offset: number) =>
    box(
      'moov',
      box('mvhd', u32(0), u32(0), u32(0), u32(sampleRate), u32(duration), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
      box(
        'trak',
        box('tkhd', u32(7), u32(0), u32(0), u32(1), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(0x100), u16(0), MATRIX, u32(0), u32(0)),
        box(
          'mdia',
          box('mdhd', u32(0), u32(0), u32(0), u32(sampleRate), u32(duration), u16(0x55c4), u16(0)),
          box('hdlr', u32(0), u32(0), text('soun'), zeros(12), text('SoundHandler'), [0]),
          box('minf', box('smhd', u32(0), u32(0)), box('dinf', box('dref', u32(0), u32(1), box('url ', u32(1)))), table(offset)),
        ),
      ),
      // The song's name, who made it and its cover, where players look for them.
      tags ?? [],
    );

  const type = box('ftyp', text('M4A '), u32(0), text('M4A '), text('mp42'), text('isom'));
  // The header comes first so the file starts playing before it has all arrived; that needs
  // the audio's position, which depends on the header's own length.
  const offset = type.length + movie(0).length + 8;
  return join([type, movie(offset), u32(size + 8), text('mdat'), ...frames]).buffer as ArrayBuffer;
}
