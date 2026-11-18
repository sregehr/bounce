/** A minimal ZIP writer: files are stored as they are, without compression (audio barely shrinks anyway). */

const table = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; size: number; crc: number };

/**
 * The parts of a ZIP that are not the files themselves: the header that goes in front of each
 * file, and the index that goes after the last one. With these, an archive can be put together
 * from the files where they already are (as Blobs), without copying them into one block of memory.
 */
export function zipFrame(files: ZipEntry[]): { headers: Uint8Array[]; end: Uint8Array } {
  const encoder = new TextEncoder();
  const entries = files.map((f) => ({ name: encoder.encode(f.name), size: f.size, crc: f.crc, offset: 0 }));
  let offset = 0;
  const headers = entries.map((e) => {
    e.offset = offset;
    const out = new Uint8Array(30 + e.name.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // names are UTF-8
    view.setUint32(14, e.crc, true);
    view.setUint32(18, e.size, true);
    view.setUint32(22, e.size, true);
    view.setUint16(26, e.name.length, true);
    out.set(e.name, 30);
    offset += out.length + e.size;
    return out;
  });
  const end = new Uint8Array(entries.reduce((n, e) => n + 46 + e.name.length, 0) + 22);
  const view = new DataView(end.buffer);
  let at = 0;
  for (const e of entries) {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, 0x0800, true);
    view.setUint32(at + 16, e.crc, true);
    view.setUint32(at + 20, e.size, true);
    view.setUint32(at + 24, e.size, true);
    view.setUint16(at + 28, e.name.length, true);
    view.setUint32(at + 42, e.offset, true);
    end.set(e.name, at + 46);
    at += 46 + e.name.length;
  }
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at, true);
  view.setUint32(at + 16, offset, true);
  return { headers, end };
}

export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const { headers, end } = zipFrame(files.map((f) => ({ name: f.name, size: f.data.length, crc: crc32(f.data) })));
  const out = new Uint8Array(headers.reduce((n, h, i) => n + h.length + files[i].data.length, 0) + end.length);
  let at = 0;
  files.forEach((f, i) => {
    out.set(headers[i], at);
    out.set(f.data, at + headers[i].length);
    at += headers[i].length + f.data.length;
  });
  out.set(end, at);
  return out;
}
