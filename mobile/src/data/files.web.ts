// Handing finished files to the user, in a browser.
import { crc32, zipFrame } from './zip';

export type OutFile = { name: string; data: ArrayBuffer | Blob; type: string };

const asFile = (f: OutFile) => new File([f.data], f.name, { type: f.type });

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * What goes out as one file: a single file as it is, and several as one ZIP named `bundle`, so a
 * song sent with its stems or its split sheet arrives as one thing and not a handful.
 */
export async function oneFile(files: OutFile[], bundle = 'Bounce export'): Promise<OutFile> {
  if (files.length === 1) return files[0];
  // The archive is put together from the files where they are, with only its small headers made
  // here. Each file is looked at once, alone, for its checksum, so a long song's three WAVs are
  // never all in memory together, let alone twice over.
  const entries = [];
  for (const f of files) {
    const bytes = new Uint8Array(f.data instanceof Blob ? await f.data.arrayBuffer() : f.data);
    entries.push({ name: f.name, size: bytes.length, crc: crc32(bytes) });
  }
  const { headers, end } = zipFrame(entries);
  const parts: BlobPart[] = files.flatMap((f, i) => [headers[i] as Uint8Array<ArrayBuffer>, f.data]);
  return { name: `${bundle}.zip`, data: new Blob([...parts, end as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), type: 'application/zip' };
}

/**
 * Saves files to the browser's downloads folder. Browsers block a page from downloading
 * several files at once, so more than one is bundled into a single ZIP named `bundle`.
 * Returns the name of what was saved.
 */
export async function saveFiles(files: OutFile[], bundle = 'Bounce export'): Promise<string> {
  const f = await oneFile(files, bundle);
  download(f.name, f.data instanceof Blob ? f.data : new Blob([f.data], { type: f.type }));
  return f.name;
}

/** True when the browser can hand files to its share sheet. */
export function canShareFiles() {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([new Uint8Array(1)], 'a.wav', { type: 'audio/wav' })] });
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet, or saves when there is none. Returns what happened. `blocked` means the
 * browser refused because too long had passed since the tap (a render ran in between): the files
 * are ready, and calling this again straight from a tap will work.
 */
export async function shareFiles(files: OutFile[], title: string): Promise<'shared' | 'saved' | 'cancelled' | 'blocked'> {
  const list = files.map(asFile);
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: list })) {
    try {
      await navigator.share({ files: list, title });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      if (e instanceof DOMException && e.name === 'NotAllowedError') return 'blocked';
    }
  }
  await saveFiles(files, title);
  return 'saved';
}

/** Rough space used and available for this site, in bytes. */
export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage.estimate();
    return { used: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}
