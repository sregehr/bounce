// Handing finished files to the user, in a browser.
import { zip } from './zip';

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
 * Saves files to the browser's downloads folder. Browsers block a page from downloading
 * several files at once, so more than one is bundled into a single ZIP named `bundle`.
 * Returns the name of what was saved.
 */
export async function saveFiles(files: OutFile[], bundle = 'Bounce export'): Promise<string> {
  if (files.length === 1) {
    const f = files[0];
    download(f.name, f.data instanceof Blob ? f.data : new Blob([f.data], { type: f.type }));
    return f.name;
  }
  const parts = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(f.data instanceof Blob ? await f.data.arrayBuffer() : f.data) })));
  download(`${bundle}.zip`, new Blob([zip(parts) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  return `${bundle}.zip`;
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
