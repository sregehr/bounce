// Reads what an audio file says about itself in its first (and last) bytes, without decoding it:
// the sample rate it was made at, and how long it runs. Decoding is what costs memory and time,
// so this is how an import picks its rate and turns away an hour-long file before reading it.

export type Sniffed = {
  format: 'wav' | 'aiff' | 'flac' | 'mp3' | 'm4a' | 'ogg' | 'aac' | null;
  /** The rate the file was made at, when its header says. */
  sampleRate: number | null;
  /** How long it runs, when the header says. */
  seconds: number | null;
  /** When the length is not written down: a length it cannot be shorter than, from its size and the format's top bitrate. */
  atLeastSeconds: number | null;
};

/** How much of each end of a file `sniffAudio` wants to see. */
export const SNIFF_BYTES = 1 << 20;

const NOTHING: Sniffed = { format: null, sampleRate: null, seconds: null, atLeastSeconds: null };

const tagAt = (b: Uint8Array, at: number, tag: string) => {
  if (at < 0 || at + tag.length > b.length) return false;
  for (let i = 0; i < tag.length; i++) if (b[at + i] !== tag.charCodeAt(i)) return false;
  return true;
};
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u64be = (b: Uint8Array, at: number) => u32be(b, at) * 4294967296 + u32be(b, at + 4);
const u64le = (b: Uint8Array, at: number) => u32le(b, at + 4) * 4294967296 + u32le(b, at);

function find(b: Uint8Array, tag: string, from = 0, to = b.length): number {
  const first = tag.charCodeAt(0);
  for (let i = from; i + tag.length <= to; i++) if (b[i] === first && tagAt(b, i, tag)) return i;
  return -1;
}
function findLast(b: Uint8Array, tag: string): number {
  const first = tag.charCodeAt(0);
  for (let i = b.length - tag.length; i >= 0; i--) if (b[i] === first && tagAt(b, i, tag)) return i;
  return -1;
}

const positive = (v: number) => (Number.isFinite(v) && v > 0 ? v : null);

function wav(b: Uint8Array, size: number): Sniffed {
  let rate = 0, byteRate = 0, at = 12;
  while (at + 8 <= b.length) {
    const length = u32le(b, at + 4);
    const body = at + 8;
    if (tagAt(b, at, 'fmt ') && body + 16 <= b.length) {
      rate = u32le(b, body + 4);
      byteRate = u32le(b, body + 8) || rate * u16le(b, body + 12);
    } else if (tagAt(b, at, 'data')) {
      // A recorder that was cut off leaves the length as zero or all ones; the rest of the file is the sound.
      const bytes = length === 0 || length === 0xffffffff ? size - body : Math.min(length, Math.max(0, size - body));
      return { format: 'wav', sampleRate: positive(rate), seconds: byteRate ? bytes / byteRate : null, atLeastSeconds: null };
    }
    at = body + length + (length % 2);
  }
  // The sound starts beyond what was read (a long list of tags first); nearly all of the file is still sound.
  return { format: 'wav', sampleRate: positive(rate), seconds: byteRate ? Math.max(0, size - Math.min(at, size)) / byteRate : null, atLeastSeconds: null };
}

/** The 80-bit number AIFF writes its sample rate as. */
function extended(b: Uint8Array, at: number) {
  const exponent = ((b[at] & 0x7f) << 8) | b[at + 1];
  const mantissa = u32be(b, at + 2) * 4294967296 + u32be(b, at + 6);
  return mantissa * Math.pow(2, exponent - 16383 - 63);
}

function aiff(b: Uint8Array): Sniffed {
  let at = 12;
  while (at + 8 <= b.length) {
    const length = u32be(b, at + 4);
    const body = at + 8;
    if (tagAt(b, at, 'COMM') && body + 18 <= b.length) {
      const rate = positive(Math.round(extended(b, body + 8)));
      return { format: 'aiff', sampleRate: rate, seconds: rate ? u32be(b, body + 2) / rate : null, atLeastSeconds: null };
    }
    at = body + length + (length % 2);
  }
  return { ...NOTHING, format: 'aiff' };
}

function flac(b: Uint8Array, at: number): Sniffed {
  // The first block is always the stream's description.
  if (at + 26 > b.length) return { ...NOTHING, format: 'flac' };
  const rate = positive((b[at + 18] << 12) | (b[at + 19] << 4) | (b[at + 20] >> 4));
  const samples = (b[at + 21] & 0x0f) * 4294967296 + u32be(b, at + 22);
  return { format: 'flac', sampleRate: rate, seconds: rate && samples ? samples / rate : null, atLeastSeconds: null };
}

const MP3_RATES = [
  [11025, 12000, 8000], // MPEG 2.5
  [],
  [22050, 24000, 16000], // MPEG 2
  [44100, 48000, 32000], // MPEG 1
];
const MP3_KBPS_1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_KBPS_2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

function mp3Frame(b: Uint8Array, at: number) {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[at + 1] >> 3) & 3;
  const layer = (b[at + 1] >> 1) & 3;
  const kbps = (version === 3 ? MP3_KBPS_1 : MP3_KBPS_2)[b[at + 2] >> 4];
  const rate = MP3_RATES[version][(b[at + 2] >> 2) & 3];
  // Layer III only: it is what every ".mp3" is.
  if (layer !== 1 || !kbps || !rate) return null;
  const perFrame = version === 3 ? 1152 : 576;
  return { version, rate, kbps, perFrame, bytes: Math.floor(((perFrame / 8) * kbps * 1000) / rate) + ((b[at + 2] >> 1) & 1) };
}

function mp3(b: Uint8Array, from: number, size: number): Sniffed | null {
  for (let at = from; at < Math.min(b.length - 4, from + 65536); at++) {
    const frame = mp3Frame(b, at);
    if (!frame) continue;
    // A real frame is followed by another at the same rate; two stray bytes that look like one are not.
    const next = mp3Frame(b, at + frame.bytes);
    if (at + frame.bytes + 4 <= b.length && (!next || next.rate !== frame.rate)) continue;
    // Files with a changing bitrate say how many frames they hold in their first one.
    const mark = Math.max(find(b, 'Xing', at, at + 200), find(b, 'Info', at, at + 200));
    const frames = mark >= 0 && mark + 12 <= b.length && u32be(b, mark + 4) & 1 ? u32be(b, mark + 8) : 0;
    const top = frame.version === 3 ? 320 : 160;
    return {
      format: 'mp3',
      sampleRate: frame.rate,
      seconds: frames ? (frames * frame.perFrame) / frame.rate : null,
      atLeastSeconds: ((size - at) * 8) / (top * 1000),
    };
  }
  return null;
}

const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** `mvhd` and `mdhd` share a layout: when it was made, then the clock's ticks per second, then the length in ticks. */
function mp4Clock(b: Uint8Array, at: number): { scale: number; ticks: number } | null {
  if (at < 0 || at + 36 > b.length) return null;
  const long = b[at + 4] === 1;
  const scale = u32be(b, at + (long ? 24 : 16));
  const ticks = long ? u64be(b, at + 28) : u32be(b, at + 20);
  return scale ? { scale, ticks } : null;
}

function m4a(head: Uint8Array, tail: Uint8Array | undefined): Sniffed {
  // The index sits at the front of files made for streaming and at the back of the rest.
  for (const part of tail ? [head, tail] : [head]) {
    const movie = mp4Clock(part, find(part, 'mvhd'));
    if (!movie) continue;
    const track = mp4Clock(part, find(part, 'mdhd'));
    // An audio track's clock ticks once per sample.
    return { format: 'm4a', sampleRate: track && track.scale >= 7350 ? track.scale : null, seconds: movie.ticks / movie.scale, atLeastSeconds: null };
  }
  return { ...NOTHING, format: 'm4a' };
}

function ogg(head: Uint8Array, tail: Uint8Array | undefined): Sniffed {
  const vorbis = find(head, '\x01vorbis', 0, 512);
  const opus = find(head, 'OpusHead', 0, 512);
  const rate = vorbis >= 0 ? positive(u32le(head, vorbis + 12)) : opus >= 0 ? 48000 : null;
  // Every page carries the number of samples played by its end; the last page's is the length.
  const end = tail ?? head;
  const last = findLast(end, 'OggS');
  const samples = last >= 0 && last + 14 <= end.length ? u64le(end, last + 6) : 0;
  return { format: 'ogg', sampleRate: rate, seconds: rate && tail && samples > 0 && samples < 2 ** 52 ? samples / rate : null, atLeastSeconds: null };
}

/**
 * What a file's own header says about it. `head` is its first bytes and `tail` its last
 * (`SNIFF_BYTES` of each is plenty; pass the whole file as `head` when it is already in memory),
 * and `size` is the length of the whole file.
 */
export function sniffAudio(head: Uint8Array, size: number, tail?: Uint8Array): Sniffed {
  if (tagAt(head, 0, 'RIFF') && tagAt(head, 8, 'WAVE')) return wav(head, size);
  if (tagAt(head, 0, 'FORM') && (tagAt(head, 8, 'AIFF') || tagAt(head, 8, 'AIFC'))) return aiff(head);
  if (tagAt(head, 4, 'ftyp')) return m4a(head, tail);
  if (tagAt(head, 0, 'OggS')) return ogg(head, tail);
  // MP3 and FLAC files often open with a block of tags, which says how long it is.
  let at = 0;
  if (tagAt(head, 0, 'ID3') && head.length > 10) at = 10 + ((head[6] & 0x7f) << 21) + ((head[7] & 0x7f) << 14) + ((head[8] & 0x7f) << 7) + (head[9] & 0x7f);
  if (tagAt(head, at, 'fLaC')) return flac(head, at);
  if (at + 4 <= head.length && head[at] === 0xff && (head[at + 1] & 0xf6) === 0xf0) return { format: 'aac', sampleRate: ADTS_RATES[(head[at + 2] >> 2) & 0xf] ?? null, seconds: null, atLeastSeconds: null };
  return mp3(head, at, size) ?? NOTHING;
}

/**
 * The rate to decode a file at: 44.1 or 48 kHz, whichever the file's own rate belongs with, so
 * a file made at either is not resampled and one made at a half or a double is resampled cleanly.
 * It never depends on what the microphone or speakers happen to be running at.
 */
export function decodeRate(fileRate: number | null): 44100 | 48000 {
  return fileRate && fileRate % 8000 === 0 ? 48000 : 44100;
}
