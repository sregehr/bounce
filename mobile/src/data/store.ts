import { useSyncExternalStore } from 'react';

import { DEFAULT_MASTER, DEFAULT_POLISH } from '@/dsp/presets';

import { blobs, kv, persist } from './db';
import { emptyLibrary, newId, type Beat, type Library, type MixSettings, type Profile, type Project, type Settings, type Take } from './model';
import { carryOver, makeSong } from './songs';

let library: Library = emptyLibrary();
let ready = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveError: string | null = null;
// Set when the saved library could not be read. Nothing is written while it is, so an empty
// library can never replace the real one.
let loadError: string | null = null;
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
    loadError = null;
    if (saved && saved.version === 1) library = { ...emptyLibrary(), ...saved, settings: { ...emptyLibrary().settings, ...saved.settings } };
    if (!library.vault) update(carryOver);
    // A library from before backups were locked to their device gets its secret now, and keeps it.
    if (saved && !saved.settings?.deviceSecret) update((l) => ({ ...l }));
    void persist();
    ready = true;
  } catch (e) {
    loadError = e instanceof Error && e.message ? e.message : 'Storage is not available.';
  }
  notify();
}

export const getLibrary = () => library;
export const useReady = () => useSyncExternalStore(subscribe, () => ready, () => ready);
export const useLoadError = () => useSyncExternalStore(subscribe, () => loadError, () => loadError);
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
  if (loadError) return;
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

// ---------- Undo for the mix ----------

const mixOf = (p: Project): MixSettings => ({ polish: p.polish, master: p.master, overrides: p.overrides, space: p.space });
const MIX_KEYS = ['polish', 'master', 'overrides', 'space'] as const;
type History = { past: MixSettings[]; future: MixSettings[]; at: number };
// Kept for this session only: undo is for the last few moves, not a record of the song.
const histories = new Map<string, History>();
const historyOf = (id: string) => histories.get(id) ?? (histories.set(id, { past: [], future: [], at: 0 }), histories.get(id)!);
let replaying = false;

/** Notes the mix as it is before a change to it, so the change can be undone. */
function remember(project: Project, patch: Partial<Project>) {
  if (replaying || !MIX_KEYS.some((k) => k in patch)) return;
  const h = historyOf(project.id);
  const now = Date.now();
  // Changes in quick succession, such as nudging one control, undo as one step.
  if (now - h.at > 700 || h.past.length === 0) h.past.push(mixOf(project));
  if (h.past.length > 50) h.past.shift();
  h.at = now;
  h.future = [];
}

function step(id: string, from: 'past' | 'future') {
  const project = getProject(id);
  const h = histories.get(id);
  const to = h?.[from].pop();
  if (!project || !h || !to) return false;
  h[from === 'past' ? 'future' : 'past'].push(mixOf(project));
  h.at = 0;
  replaying = true;
  patchProject(id, { ...to });
  replaying = false;
  return true;
}

export const undoMix = (id: string) => step(id, 'past');
export const redoMix = (id: string) => step(id, 'future');

/** Whether there is a mix change to undo or redo for a project. */
export function useMixHistory(id: string | null) {
  const key = useSyncExternalStore(subscribe, () => `${histories.get(id ?? '')?.past.length ?? 0}/${histories.get(id ?? '')?.future.length ?? 0}`, () => '0/0');
  const [past, future] = key.split('/').map(Number);
  return { canUndo: past > 0, canRedo: future > 0 };
}

/**
 * Switches between two mixes of the same song. The first switch to B starts it as a copy of A,
 * so the two can then be taken in different directions and compared.
 */
export function switchMix(id: string, side: 'A' | 'B') {
  const project = getProject(id);
  if (!project || (project.mixSide ?? 'A') === side) return;
  patchProject(id, { ...(project.mixAlt ?? mixOf(project)), mixAlt: mixOf(project), mixSide: side });
}

export function patchProject(id: string, patch: Partial<Project> | ((p: Project) => Partial<Project>), touch = true) {
  const before = getProject(id);
  if (before) remember(before, typeof patch === 'function' ? patch(before) : patch);
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
    // A new beat plays through whole; looping 8 or 16 bars is a choice made on the mic screen.
    loop: { bars: 0, startBar: 0 },
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

/** Makes a finished song the one the player shows. */
export const openSong = (id: string) => update((l) => (l.currentId === id && l.songId === id ? l : { ...l, currentId: id, songId: id }));

/** Saves the take and settings a beat has now as a finished song in the Vault, ready to play. */
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
