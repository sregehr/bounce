// One-way backup of the local library to the Convex backend. The device stays the source of
// truth: this only sends, and nothing here blocks the app when the server cannot be reached.
import { useSyncExternalStore } from 'react';
import { ConvexHttpClient } from 'convex/browser';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { blobs, kv } from './db';
import type { Library, Project } from './model';
import { getLibrary, onLibraryChange } from './store';

export type BackupState = { status: 'off' | 'idle' | 'working' | 'unreachable' | 'done'; pending: number; lastAt: number | null };

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const client = url ? new ConvexHttpClient(url) : null;

let state: BackupState = { status: client ? 'idle' : 'off', pending: 0, lastAt: null };
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
let running = false;
let again = false;

async function run() {
  const library: Library = getLibrary();
  if (!client || !library.settings.backup) return set({ status: 'off', pending: 0 });
  if (running) {
    again = true;
    return;
  }
  running = true;
  const deviceId = library.settings.deviceId;
  try {
    const sent = (await kv.get<Sent>('backup')) ?? {};
    const remote = new Set(await client.query(api.backup.fileKeys, { deviceId }));
    const missing = [...new Set(library.projects.flatMap(keysOf))].filter((k) => !remote.has(k));
    const changed = library.projects.filter((p) => sent[p.id]?.updatedAt !== p.updatedAt);
    const gone = Object.keys(sent).filter((id) => !library.projects.some((p) => p.id === id));
    if (missing.length + changed.length + gone.length === 0) {
      set({ status: 'done', pending: 0 });
    } else {
      set({ status: 'working', pending: missing.length });
      let left = missing.length;
      for (const key of missing) {
        const blob = await blobs.get(key);
        if (blob) {
          const target = await client.mutation(api.backup.uploadUrl, {});
          const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
          if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
          const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
          await client.mutation(api.backup.saveFile, { deviceId, key, storageId, size: blob.size });
        }
        set({ pending: --left });
      }
      const live = new Set(library.projects.flatMap(keysOf));
      for (const p of changed) {
        await client.mutation(api.backup.saveProject, { deviceId, localId: p.id, name: p.name, updatedAt: p.updatedAt, data: JSON.stringify(p) });
        sent[p.id] = { updatedAt: p.updatedAt, keys: keysOf(p) };
      }
      for (const id of gone) {
        await client.mutation(api.backup.removeProject, { deviceId, localId: id, fileKeys: sent[id].keys.filter((k) => !live.has(k)) });
        delete sent[id];
      }
      await kv.set('backup', sent);
      set({ status: 'done', pending: 0, lastAt: Date.now() });
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
