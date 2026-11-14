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

export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const entries = files.map((f) => ({ name: encoder.encode(f.name), data: f.data, crc: crc32(f.data), offset: 0 }));
  const local = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  const central = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  const out = new Uint8Array(local + central + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const e of entries) {
    e.offset = at;
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 0x0800, true); // names are UTF-8
    view.setUint32(at + 14, e.crc, true);
    view.setUint32(at + 18, e.data.length, true);
    view.setUint32(at + 22, e.data.length, true);
    view.setUint16(at + 26, e.name.length, true);
    out.set(e.name, at + 30);
    out.set(e.data, at + 30 + e.name.length);
    at += 30 + e.name.length + e.data.length;
  }
  const start = at;
  for (const e of entries) {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, 0x0800, true);
    view.setUint32(at + 16, e.crc, true);
    view.setUint32(at + 20, e.data.length, true);
    view.setUint32(at + 24, e.data.length, true);
    view.setUint16(at + 28, e.name.length, true);
    view.setUint32(at + 42, e.offset, true);
    out.set(e.name, at + 46);
    at += 46 + e.name.length;
  }
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - start, true);
  view.setUint32(at + 16, start, true);
  return out;
}
