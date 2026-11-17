// One-way backup of the local library to the Convex backend. The device stays the source of
// truth: this only sends, and nothing here blocks the app when the server cannot be reached.
import { useSyncExternalStore } from 'react';
import { ConvexHttpClient } from 'convex/browser';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { blobs, kv } from './db';
import type { Library, Project } from './model';
import { flushLibrary, getLibrary, onLibraryChange, update } from './store';

export type BackupState = { status: 'off' | 'idle' | 'working' | 'unreachable' | 'done' | 'full'; pending: number; lastAt: number | null; /** Files left out because each is bigger than the server takes. */ skipped: number };

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const client = url ? new ConvexHttpClient(url) : null;

let state: BackupState = { status: client ? 'idle' : 'off', pending: 0, lastAt: null, skipped: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<BackupState>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

export function useBackup(): BackupState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

const keysOf = (p: Project) => [p.beat.key, ...p.takes.map((t) => t.key), p.cover.photoKey, p.cover.cutoutKey, p.cover.imageKey].filter((k): k is string => !!k);

type Sent = Record<string, { updatedAt: number; keys: string[] }>;
/** Which backup, and the proof that it is this device's. */
type Owner = { deviceId: string; secret: string };
let running = false;
let again = false;

/** Deletes a backup from the server, a batch at a time. Throws if the server cannot be reached. */
async function erase(owner: Owner) {
  if (!client) return;
  for (let i = 0; i < 200; i++) if (await client.mutation(api.backup.erase, owner)) return;
  throw new Error('The backup is taking too long to delete.');
}

/**
 * Deletes this device's backup from the server, for "Delete everything on this device". If the
 * server cannot be reached now, the request is kept and sent again the next time a backup runs.
 * Returns whether the server copy is gone already.
 */
export async function eraseBackup(owner: Owner): Promise<boolean> {
  if (!client) return true;
  try {
    await erase(owner);
    return true;
  } catch {
    const waiting = (await kv.get<Owner[]>('erase').catch(() => undefined)) ?? [];
    await kv.set('erase', [...waiting, owner]).catch(() => {});
    return false;
  }
}

/** Sends any deletions that could not reach the server earlier. */
async function eraseWaiting() {
  const waiting = (await kv.get<Owner[]>('erase')) ?? [];
  if (waiting.length === 0) return;
  const left: Owner[] = [];
  for (const owner of waiting) await erase(owner).catch(() => left.push(owner));
  await kv.set('erase', left);
}

async function run() {
  const library: Library = getLibrary();
  // A deletion that is owed goes out whether or not backup is still switched on.
  if (client && !running) await eraseWaiting().catch(() => {});
  if (!client || !library.settings.backup) return set({ status: 'off', pending: 0 });
  if (running) {
    again = true;
    return;
  }
  running = true;
  const owner: Owner = { deviceId: library.settings.deviceId, secret: library.settings.deviceSecret };
  try {
    const sent = (await kv.get<Sent>('backup')) ?? {};
    const remote = new Set(await client.query(api.backup.fileKeys, owner));
    const missing = [...new Set(library.projects.flatMap(keysOf))].filter((k) => !remote.has(k));
    const changed = library.projects.filter((p) => sent[p.id]?.updatedAt !== p.updatedAt);
    const gone = Object.keys(sent).filter((id) => !library.projects.some((p) => p.id === id));
    if (missing.length + changed.length + gone.length === 0) {
      set({ status: 'done', pending: 0 });
    } else {
      set({ status: 'working', pending: missing.length });
      let left = missing.length;
      // The server says how much room is left, so a file it would refuse is never sent.
      const room = await client.query(api.backup.room, owner);
      let used = room.bytes;
      let count = room.files;
      let skipped = 0;
      let full = false;
      for (const key of missing) {
        const blob = await blobs.get(key);
        if (blob && blob.size > room.maxFile) skipped++;
        else if (blob && (full || used + blob.size > room.maxBytes || count >= room.maxFiles)) full = true;
        else if (blob) {
          const target = await client.mutation(api.backup.uploadUrl, owner);
          const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
          if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
          const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
          const answer = await client.mutation(api.backup.saveFile, { ...owner, key, storageId, size: blob.size });
          if (answer === 'too_big') skipped++;
          else if (answer === 'full') full = true;
          else {
            used += blob.size;
            count++;
          }
        }
        set({ pending: --left });
      }
      const live = new Set(library.projects.flatMap(keysOf));
      for (const p of changed) {
        await client.mutation(api.backup.saveProject, { ...owner, localId: p.id, name: p.name, updatedAt: p.updatedAt, data: JSON.stringify(p) });
        sent[p.id] = { updatedAt: p.updatedAt, keys: keysOf(p) };
      }
      for (const id of gone) {
        await client.mutation(api.backup.removeProject, { ...owner, localId: id, fileKeys: sent[id].keys.filter((k) => !live.has(k)) });
        delete sent[id];
      }
      await kv.set('backup', sent);
      set({ status: full ? 'full' : 'done', pending: 0, lastAt: Date.now(), skipped });
    }
  } catch {
    set({ status: 'unreachable', pending: 0 });
  }
  running = false;
  if (again) {
    again = false;
    void run();
  }
}

/** Backs up shortly after launch and after every change, and retries once a minute while the server is away. */
export function startBackup() {
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(run, 4000);
  const off = onLibraryChange(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 3000);
  });
  const retry = setInterval(() => state.status === 'unreachable' && void run(), 60000);
  return () => {
    off();
    if (timer) clearTimeout(timer);
    clearInterval(retry);
  };
}

export const backupNow = () => void run();
export const backupAvailable = !!client;

// ---------- Bringing a backup onto another device ----------

/** What another device needs to open this one's backup. Anyone holding it can read the backup, so it is shown only on request. */
export const restoreCode = () => `${getLibrary().settings.deviceId}.${getLibrary().settings.deviceSecret}`;

/**
 * Copies a backup onto this device from its restore code. Songs already here are left alone;
 * the rest arrive with their audio and covers. Returns how many songs were added.
 */
export async function restoreBackup(code: string, onProgress?: (left: number) => void): Promise<number> {
  if (!client) throw new Error('This build has no backup server to restore from.');
  const [deviceId, secret] = code.trim().split('.');
  if (!deviceId || !secret || secret.length < 32) throw new Error('That does not look like a restore code. Copy it again from Settings on the other device.');
  const found = await client.query(api.backup.restore, { deviceId, secret }).catch(() => {
    throw new Error('The backup server could not be reached. Check the connection and try again.');
  });
  if (!found) throw new Error('No backup was found for that code. Check that the other device has finished backing up.');
  const here = new Set(getLibrary().projects.map((p) => p.id));
  const incoming = found.projects.flatMap((row) => {
    try {
      const project = JSON.parse(row.data) as Project;
      return project?.id && project.beat?.key && !here.has(project.id) ? [project] : [];
    } catch {
      return [];
    }
  });
  const have = new Set(await blobs.keys());
  const wanted = new Set(incoming.flatMap(keysOf));
  const fetchable = found.files.filter((f) => wanted.has(f.key) && !have.has(f.key) && f.url);
  let left = fetchable.length;
  onProgress?.(left);
  for (const file of fetchable) {
    const response = await fetch(file.url!);
    if (!response.ok) throw new Error(`A file could not be downloaded (${response.status}). Try again.`);
    await blobs.put(file.key, await response.blob());
    have.add(file.key);
    onProgress?.(--left);
  }
  // Only songs whose beat arrived are added; one without its audio would not open.
  const whole = incoming.filter((p) => have.has(p.beat.key));
  if (whole.length) update((l) => ({ ...l, projects: [...whole.map((p) => ({ ...p, takes: p.takes.filter((t) => have.has(t.key)) })), ...l.projects] }));
  await flushLibrary();
  return whole.length;
}
