// Decoded audio and finished mixes are big: a four-minute stereo song is about 90 MB a copy.
// These caches are therefore held to a number of bytes rather than a number of entries, and a
// phone gets a smaller allowance than a laptop, since its browser closes a tab that uses too much.

/** A most-recently-used cache kept within a byte budget. The newest entry always stays, whatever its size. */
export class SizedCache<V> {
  private entries = new Map<string, { value: V; bytes: number }>();
  constructor(private budget: () => number) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    // Used again, so it is the last to go.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, bytes: number) {
    this.entries.delete(key);
    this.entries.set(key, { value, bytes });
    this.trim();
  }

  /** Sets the size of an entry that was added before its size was known (a render still in progress). */
  resize(key: string, value: V, bytes: number) {
    const hit = this.entries.get(key);
    if (!hit || hit.value !== value) return;
    hit.bytes = bytes;
    this.trim();
  }

  delete(key: string) {
    this.entries.delete(key);
  }

  /** Drops everything except the named entries. */
  keepOnly(keys: string[]) {
    for (const key of [...this.entries.keys()]) if (!keys.includes(key)) this.entries.delete(key);
  }

  get bytes() {
    let sum = 0;
    for (const e of this.entries.values()) sum += e.bytes;
    return sum;
  }

  get size() {
    return this.entries.size;
  }

  private trim() {
    const budget = this.budget();
    while (this.entries.size > 1 && this.bytes > budget) this.entries.delete(this.entries.keys().next().value as string);
  }
}

export const MB = 1024 * 1024;
export type AudioBudget = { /** Decoded beats and takes. */ pcm: number; /** Finished mixes. */ mixes: number };

/**
 * How much audio to keep ready. On a phone or tablet: the beat and a few takes of a long song,
 * and one finished mix of it (two or three of a short one). On a computer: several of each.
 */
export function budgetFor(device: { touchFirst: boolean; memoryGb?: number }): AudioBudget {
  const small = device.touchFirst || (device.memoryGb !== undefined && device.memoryGb <= 4);
  return small ? { pcm: 200 * MB, mixes: 110 * MB } : { pcm: 600 * MB, mixes: 400 * MB };
}

let found: AudioBudget | null = null;
/** The budget for the device this is running on. A phone app, which has no `matchMedia`, counts as a phone. */
export function audioBudget(): AudioBudget {
  if (!found) {
    const touchFirst = typeof matchMedia !== 'function' || matchMedia('(pointer: coarse)').matches;
    const memoryGb = typeof navigator !== 'undefined' ? (navigator as { deviceMemory?: number }).deviceMemory : undefined;
    found = budgetFor({ touchFirst, memoryGb });
  }
  return found;
}

export const bytesOf = (channels: Float32Array[]) => channels.reduce((n, ch) => n + ch.byteLength, 0);
