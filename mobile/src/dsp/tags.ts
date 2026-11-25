// What a finished file says about itself: the song's name and who made it, written into the file
// so the credit travels with the audio and is not a second file that gets left behind.

export type Tags = {
  title?: string;
  artist?: string;
  /** Who made the beat. */
  producer?: string;
  /** Who wrote it, as one line of names. */
  writer?: string;
  /** Anything else worth saying, such as everyone credited and their shares. */
  comment?: string;
  /** The year the file was made. */
  year?: number;
  /** The cover, for the formats that can hold one. */
  cover?: { data: Uint8Array; type: 'image/jpeg' | 'image/png' };
};

type Part = Uint8Array | number[];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 255);
const utf8 = (s: string) => new TextEncoder().encode(s);

function join(parts: Part[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const box = (name: string, ...parts: Part[]) => {
  const body = join(parts);
  return join([u32(body.length + 8), ascii(name), body]);
};

const said = (value: string | undefined) => value?.replace(/\s+/g, ' ').trim() ?? '';

/**
 * The tags as an MP4 `udta` box, to sit inside `moov`: the kind Apple's apps write and every phone
 * and music app reads. Null when there is nothing to say.
 */
export function m4aTags(tags: Tags): Uint8Array | null {
  // One value: a type (1 is text, 13 a JPEG, 14 a PNG), a locale, then the value itself.
  const data = (type: number, value: Part) => box('data', u32(type), u32(0), value);
  const named = (name: string, value: string | undefined) => (said(value) ? [box(name, data(1, utf8(said(value))))] : []);
  // Fields with no four-letter name of their own are filed under a name spelled out, the way iTunes does.
  const custom = (name: string, value: string | undefined) => (said(value) ? [box('----', box('mean', u32(0), ascii('com.apple.iTunes')), box('name', u32(0), ascii(name)), data(1, utf8(said(value))))] : []);
  const items = [
    ...named('©nam', tags.title),
    ...named('©ART', tags.artist),
    ...named('©wrt', tags.writer),
    ...named('©cmt', tags.comment),
    ...named('©day', tags.year ? String(tags.year) : undefined),
    ...custom('PRODUCER', tags.producer),
    ...(tags.cover ? [box('covr', data(tags.cover.type === 'image/png' ? 14 : 13, tags.cover.data))] : []),
  ];
  if (items.length === 0) return null;
  items.push(...named('©too', 'Bounce'));
  const handler = box('hdlr', u32(0), u32(0), ascii('mdir'), ascii('appl'), u32(0), u32(0), [0]);
  return box('udta', box('meta', u32(0), handler, box('ilst', ...items)));
}

/**
 * The tags as a WAV `LIST` chunk, to follow the audio. WAV has few fields and no place for a producer
 * or a cover, so the producer goes in the comment. Null when there is nothing to say.
 */
export function wavTags(tags: Tags): Uint8Array | null {
  const field = (id: string, value: string | undefined) => {
    if (!said(value)) return [];
    // Each value ends in a zero and is padded to an even length.
    const bytes = utf8(said(value));
    const size = bytes.length + 1;
    return [join([ascii(id), le32(size), bytes, [0], size % 2 ? [0] : []])];
  };
  const comment = [said(tags.producer) ? `Produced by ${said(tags.producer)}.` : '', said(tags.writer) ? `Written by ${said(tags.writer)}.` : '', said(tags.comment)].filter(Boolean).join(' ');
  const fields = [...field('INAM', tags.title), ...field('IART', tags.artist), ...field('ICMT', comment), ...field('ICRD', tags.year ? String(tags.year) : undefined)];
  if (fields.length === 0) return null;
  const body = join([ascii('INFO'), ...fields, ...field('ISFT', 'Bounce')]);
  return join([ascii('LIST'), le32(body.length), body]);
}

const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
