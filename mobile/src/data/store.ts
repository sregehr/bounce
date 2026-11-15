import { useSyncExternalStore } from 'react';

import { DEFAULT_MASTER, DEFAULT_POLISH } from '@/dsp/presets';

import { blobs, kv, persist } from './db';
import { emptyLibrary, newId, type Beat, type Library, type Profile, type Project, type Settings, type Take } from './model';
import { carryOver, makeSong } from './songs';

let library: Library = emptyLibrary();
let ready = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveError: string | null = null;
const listeners = new Set<() => void>();
const changeHooks = new Set<(l: Library) => void>();

const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Reads the saved library. Safe to call more than once. */
export async function loadLibrary() {
  if (ready) return;
  try {
    const saved = await kv.get<Library>('library');
    if (saved && saved.version === 1) library = { ...emptyLibrary(), ...saved, settings: { ...emptyLibrary().settings, ...saved.settings } };
    if (!library.vault) update(carryOver);
    void persist();
  } catch (e) {
    saveError = e instanceof Error ? e.message : 'Storage is not available.';
  }
  ready = true;
  notify();
}

export const getLibrary = () => library;
export const useReady = () => useSyncExternalStore(subscribe, () => ready, () => ready);
export const useSaveError = () => useSyncExternalStore(subscribe, () => saveError, () => saveError);

/** Subscribes to part of the library. `pick` must return something stable (a stored value, not a new object). */
export function useLibrary<T>(pick: (l: Library) => T): T {
  return useSyncExternalStore(subscribe, () => pick(library), () => pick(library));
}

/** Runs after every change, for things like the backup. */
export function onLibraryChange(fn: (l: Library) => void) {
  changeHooks.add(fn);
  return () => changeHooks.delete(fn);
}

export function update(change: (l: Library) => Library) {
  library = change(library);
  notify();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    kv.set('library', library).then(
      () => {
        if (saveError) {
          saveError = null;
          notify();
        }
      },
      (e) => {
        saveError = e instanceof Error ? e.message : 'Could not save.';
        notify();
      },
    );
    changeHooks.forEach((fn) => fn(library));
  }, 250);
}

export const setProfile = (patch: Partial<Profile>) => update((l) => ({ ...l, profile: { ...l.profile, ...patch } }));
export const setSettings = (patch: Partial<Settings>) => update((l) => ({ ...l, settings: { ...l.settings, ...patch } }));
export const setCurrent = (id: string | null) => update((l) => (l.currentId === id ? l : { ...l, currentId: id }));

export function useProject(): Project | null {
  const id = useLibrary((l) => l.currentId);
  const projects = useLibrary((l) => l.projects);
  return projects.find((p) => p.id === id) ?? null;
}

export const getProject = (id: string | null) => library.projects.find((p) => p.id === id) ?? null;

export function patchProject(id: string, patch: Partial<Project> | ((p: Project) => Partial<Project>), touch = true) {
  update((l) => ({
    ...l,
    projects: l.projects.map((p) => (p.id === id ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch), ...(touch ? { updatedAt: Date.now() } : null) } : p)),
  }));
}

/** The next free "Untitled beat N". */
export function nextBeatName() {
  const used = new Set(library.projects.map((p) => p.name));
  for (let n = library.projects.filter((p) => !p.saved).length + 1; ; n++) if (!used.has(`Untitled beat ${n}`)) return `Untitled beat ${n}`;
}

export function createProject(beat: Beat, name: string): Project {
  const now = Date.now();
  const project: Project = {
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    beat,
    loop: { bars: 8, startBar: 0 },
    takes: [],
    takeId: null,
    polish: DEFAULT_POLISH,
    master: DEFAULT_MASTER,
    overrides: {},
    exporting: { loudness: 'streaming', format: 'wav24', instrumental: true, vocals: false },
    snippet: { lengthSec: 20, captions: true, credit: true, caption: '', made: false },
    cover: { scene: 'photo', photoKey: null, cutoutKey: null, imageKey: null },
    lyrics: '',
    stats: null,
  };
  update((l) => ({ ...l, projects: [project, ...l.projects], currentId: project.id }));
  return project;
}

const projectKeys = (p: Project) => [p.beat.key, ...p.takes.map((t) => t.key), p.cover.photoKey, p.cover.cutoutKey, p.cover.imageKey].filter((k): k is string => !!k);

export async function deleteProject(id: string) {
  const project = getProject(id);
  if (!project) return;
  update((l) => ({ ...l, projects: l.projects.filter((p) => p.id !== id), currentId: l.currentId === id ? null : l.currentId, songId: l.songId === id ? null : l.songId }));
  await Promise.all(projectKeys(project).map(dropBlob));
}

/** Deletes a stored file unless something still uses it: a finished song shares its audio and cover with the beat it came from. */
export async function dropBlob(key: string) {
  if (library.projects.some((p) => projectKeys(p).includes(key))) return;
  await blobs.delete(key).catch(() => {});
}

/** Loads a finished song into the Player. */
export const openSong = (id: string) => update((l) => (l.currentId === id && l.songId === id ? l : { ...l, currentId: id, songId: id }));

/** Saves the take and settings a beat has now as a finished song in the Vault, and loads it into the Player. */
export function finishSong(projectId: string, title: string): Project | null {
  const project = getProject(projectId);
  if (!project) return null;
  const song = makeSong(project, title);
  update((l) => ({ ...l, projects: [song, ...l.projects], currentId: song.id, songId: song.id }));
  return song;
}

export function addTake(projectId: string, take: Take) {
  patchProject(projectId, (p) => ({ takes: [...p.takes, take], takeId: take.id }));
}

export async function deleteTake(projectId: string, takeId: string) {
  const take = getProject(projectId)?.takes.find((t) => t.id === takeId);
  if (!take) return;
  patchProject(projectId, (p) => {
    const takes = p.takes.filter((t) => t.id !== takeId);
    return { takes, takeId: p.takeId === takeId ? (takes[takes.length - 1]?.id ?? null) : p.takeId };
  });
  await dropBlob(take.key);
}

/** The take a project is currently working with. */
export const activeTake = (p: Project | null) => p?.takes.find((t) => t.id === p.takeId) ?? null;
