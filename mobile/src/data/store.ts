import { useSyncExternalStore } from 'react';

import { DEFAULT_MASTER, DEFAULT_POLISH, type Chain, type VocalStyle } from '@/dsp/presets';

import { adopts, artistNamed, artistsIn, sessionArtist, withArtist } from './artists';
import { blobs, kv, persist } from './db';
import { LAYER_START, emptyLibrary, newId, type Artist, type Beat, type Layer, type Library, type MixSettings, type Profile, type Project, type Settings, type Take } from './model';
import { carryOver, makeSong, mendSongs, oneMix } from './songs';

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
    // Finished songs that lost their layered takes get them back from their beat, where it still has them.
    if (mendSongs(library) !== library) update(mendSongs);
    // A song has one mix now. A second mix or mixes saved by name, from when it could have them, are let go; the mix in use stays as it is.
    if (oneMix(library) !== library) update(oneMix);
    // A library from before backups were locked to their device gets its secret now, and keeps it.
    if (saved && !saved.settings?.deviceSecret) update((l) => ({ ...l }));
    void persist();
    void emptyBin();
    void loadHistories();
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

/** Writes any change still waiting to be saved, now. For moments that cannot wait: the page going away, or a restore finishing. */
export async function flushLibrary() {
  if (!saveTimer || loadError) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await kv.set('library', library).catch((e) => {
    saveError = e instanceof Error ? e.message : 'Could not save.';
    notify();
  });
  changeHooks.forEach((fn) => fn(library));
}

// A change made in the last moment before the tab is closed, reloaded or put away is still saved.
if (typeof document !== 'undefined' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => void (flushLibrary(), flushHistories()));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void (flushLibrary(), flushHistories()));
}

export const setProfile = (patch: Partial<Profile>) => update((l) => ({ ...l, profile: { ...l.profile, ...patch } }));
export const setSettings = (patch: Partial<Settings>) => update((l) => ({ ...l, settings: { ...l.settings, ...patch } }));
export const setCurrent = (id: string | null) => update((l) => (l.currentId === id ? l : { ...l, currentId: id }));

// ---------- Artists ----------

/** Saves a profile for a name, or finds the one that name already has. */
export function saveArtist(name: string): Artist | null {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return null;
  const known = artistNamed(library, trimmed);
  if (known) return known;
  const artist: Artist = { id: newId(), name: trimmed, createdAt: Date.now() };
  // Songs that already carry the name, from before it had a profile, are joined to it.
  update((l) => ({ ...l, artists: [...artistsIn(l), artist], projects: l.projects.map((p) => (!p.artistId && p.artist?.trim().toLowerCase() === trimmed.toLowerCase() ? { ...p, artistId: artist.id } : p)) }));
  return artist;
}

/** Renames an artist, on their profile and on every song of theirs. */
export function renameArtist(id: string, name: string) {
  update((l) => ({ ...l, artists: artistsIn(l).map((a) => (a.id === id ? { ...a, name } : a)), projects: l.projects.map((p) => (p.artistId === id ? { ...p, artist: name } : p)) }));
}

/** Keeps a vocal chain, and the style it was made under, as the sound for an artist. */
export function setArtistSound(id: string, chain: Chain | undefined, style?: VocalStyle) {
  update((l) => ({ ...l, artists: artistsIn(l).map((a) => (a.id === id ? { ...a, chain, style: chain ? style : undefined } : a)) }));
}

/** Removes a profile. Their songs keep their name. */
export function removeArtist(id: string) {
  update((l) => ({ ...l, artists: artistsIn(l).filter((a) => a.id !== id), sessionArtistId: l.sessionArtistId === id ? null : l.sessionArtistId, projects: l.projects.map((p) => (p.artistId === id ? { ...p, artistId: undefined } : p)) }));
}

/** Puts an artist on a song: their name, and their vocal chain where the song has none of its own. */
export function setSongArtist(projectId: string, artist: Artist) {
  patchProject(projectId, (p) => withArtist(p, artist), false);
}

/**
 * Says who is at the mic from now on, or no one. New songs and takes are theirs until it is
 * changed. The song open at the time becomes theirs too if it is no one's yet, or has no takes.
 */
export function setSession(artistId: string | null, projectId?: string | null) {
  update((l) => ({ ...l, sessionArtistId: artistId }));
  const artist = sessionArtist(library);
  const project = getProject(projectId ?? null);
  if (artist && project && !project.saved && (adopts(project) || project.takes.length === 0)) setSongArtist(project.id, artist);
}

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
// Undo is for the last few moves, not a record of the song: each song keeps its last steps, and
// they are written down so a reload does not lose them.
const histories = new Map<string, History>();
const historyOf = (id: string) => histories.get(id) ?? (histories.set(id, { past: [], future: [], at: 0 }), histories.get(id)!);
let replaying = false;
/** The most steps kept for one song, back or forward. */
export const UNDO_STEPS = 50;
const UNDO_KEY = 'undo:mix';
let undoTimer: ReturnType<typeof setTimeout> | null = null;
let undoLoaded = false;

const savedHistories = () => Object.fromEntries([...histories].filter(([, h]) => h.past.length || h.future.length).map(([id, h]) => [id, { past: h.past, future: h.future }]));

/** Writes the undo steps down a moment after they change. A failure only costs the steps, so it is not reported. */
function keepHistories() {
  if (!undoLoaded || loadError) return;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoTimer = null;
    void kv.set(UNDO_KEY, savedHistories()).catch(() => {});
  }, 400);
}

/** Writes any undo steps still waiting, now. */
export async function flushHistories() {
  if (!undoTimer) return;
  clearTimeout(undoTimer);
  undoTimer = null;
  await kv.set(UNDO_KEY, savedHistories()).catch(() => {});
}

/** Brings back the undo steps kept from last time, for the songs that are still here. */
async function loadHistories() {
  const saved = await kv.get<Record<string, { past: MixSettings[]; future: MixSettings[] }>>(UNDO_KEY).catch(() => undefined);
  for (const [id, h] of Object.entries(saved ?? {})) {
    if (!getProject(id) || histories.has(id) || !Array.isArray(h?.past) || !Array.isArray(h?.future)) continue;
    histories.set(id, { past: h.past.slice(-UNDO_STEPS), future: h.future.slice(-UNDO_STEPS), at: 0 });
  }
  undoLoaded = true;
  notify();
}

/** Notes the mix as it is before a change to it, so the change can be undone. */
function remember(project: Project, patch: Partial<Project>) {
  if (replaying || !MIX_KEYS.some((k) => k in patch)) return;
  const h = historyOf(project.id);
  const now = Date.now();
  // Changes in quick succession, such as nudging one control, undo as one step.
  if (now - h.at > 700 || h.past.length === 0) h.past.push(mixOf(project));
  if (h.past.length > UNDO_STEPS) h.past.shift();
  h.at = now;
  h.future = [];
  keepHistories();
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
  keepHistories();
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

// ---------- Undo for the song ----------

/**
 * One edit to a song that can be taken back: a deleted take, a change to the layers or the best
 * bars, or a stretch of typing in the lyrics. Each knows how to undo itself against the song as
 * it is now, so a take recorded since is left alone.
 */
export type SongEdit = {
  kind: 'take' | 'layers' | 'bars' | 'lyrics';
  /** What was done, in words that follow "Undo": "Deleted take 2". */
  label: string;
  back: (p: Project) => Partial<Project>;
  forth: (p: Project) => Partial<Project>;
  /** Stored files this edit can still bring back. They are kept for as long as it can. */
  holds?: string[];
  /** One of a run of small changes, such as typing or dragging a slider: undoable, but not announced each time. */
  quiet?: boolean;
  at: number;
  /** When the run of changes this one stands for began, and what ties them together. */
  began: number;
  group?: string;
};
type SongHistory = { past: SongEdit[]; future: SongEdit[] };
// For this session only, like the mix's: undo is for the last few moves.
const songHistories = new Map<string, SongHistory>();
const songHistoryOf = (id: string) => songHistories.get(id) ?? (songHistories.set(id, { past: [], future: [] }), songHistories.get(id)!);

const heldKeys = () => new Set([...songHistories.values()].flatMap((h) => [...h.past, ...h.future]).flatMap((e) => e.holds ?? []));

/** Lets go of edits that can no longer be undone or redone, and of the files only they were keeping. */
function release(edits: SongEdit[]) {
  for (const key of edits.flatMap((e) => e.holds ?? [])) void dropBlob(key);
}

/**
 * Notes an edit so it can be undone. Changes of the same thing in quick succession, such as
 * dragging one slider or typing one line, count as one: `group` names the thing, `within` is how
 * long a pause still belongs to it, and `span` is the longest one step may run.
 */
function note(projectId: string, edit: Omit<SongEdit, 'at' | 'began'>, within = 0, span = 0) {
  const h = songHistoryOf(projectId);
  const now = Date.now();
  const last = h.past[h.past.length - 1];
  if (last && edit.group && last.group === edit.group && h.future.length === 0 && now - last.at < within && now - last.began < span) {
    // The step keeps where it started from and takes on where it has got to.
    last.forth = edit.forth;
    last.label = edit.label;
    last.at = now;
    return;
  }
  h.past.push({ ...edit, at: now, began: now });
  release([...h.future, ...h.past.splice(0, Math.max(0, h.past.length - 50))]);
  h.future = [];
}

function stepSong(id: string, from: 'past' | 'future') {
  const h = songHistories.get(id);
  const edit = h?.[from].pop();
  if (!h || !edit || !getProject(id)) return null;
  h[from === 'past' ? 'future' : 'past'].push(edit);
  // A step taken back is no longer added to by the next change.
  edit.at = 0;
  patchProject(id, from === 'past' ? edit.back : edit.forth);
  return edit;
}

/** Takes back the last edit to a song, or puts back the last one taken back. Returns what it was, or null when there was nothing. */
export const undoSong = (id: string) => stepSong(id, 'past');
export const redoSong = (id: string) => stepSong(id, 'future');

/** What can be undone and redone on a song, and the edit made last, for offering to undo it there and then. */
export function useSongHistory(id: string | null) {
  const key = useSyncExternalStore(
    subscribe,
    () => {
      const h = songHistories.get(id ?? '');
      const last = h?.past[h.past.length - 1];
      const next = h?.future[h.future.length - 1];
      return JSON.stringify([last ? [last.label, last.kind, last.at, !!last.quiet] : null, next ? next.label : null]);
    },
    () => 'null',
  );
  const [last, redo] = (JSON.parse(key) as [[string, SongEdit['kind'], number, boolean] | null, string | null] | null) ?? [null, null];
  return { canUndo: !!last, canRedo: !!redo, undo: last ? { label: last[0], kind: last[1], at: last[2], quiet: last[3] } : null, redo };
}

// A deleted take's audio stays on the device while the delete can be undone. Its key is written
// down, so if the app is closed first the file is cleared out the next time it opens.
let bin: string[] = [];
function toBin(key: string) {
  bin = [...bin, key];
  void kv.set('bin', bin).catch(() => {});
}
async function emptyBin() {
  const waiting = (await kv.get<string[]>('bin').catch(() => undefined)) ?? [];
  await Promise.all(waiting.map(dropBlob));
  // Anything binned while that ran is kept on the list.
  await kv.set('bin', bin).catch(() => {});
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
    // A new song starts on "Post or upload", the first of Share's choices that every browser can make.
    exporting: { loudness: 'loud', format: 'wav16', instrumental: false, vocals: false },
    snippet: { lengthSec: 20, captions: true, credit: true, caption: '', made: false },
    cover: { scene: 'photo', photoKey: null, cutoutKey: null, imageKey: null },
    lyrics: '',
    stats: null,
  };
  // A beat brought in during a session starts out as that artist's song, with their sound.
  const artist = sessionArtist(library);
  if (artist) Object.assign(project, withArtist(project, artist));
  update((l) => ({ ...l, projects: [project, ...l.projects], currentId: project.id }));
  return project;
}

const projectKeys = (p: Project) => [p.beat.key, ...p.takes.map((t) => t.key), p.cover.photoKey, p.cover.cutoutKey, p.cover.imageKey].filter((k): k is string => !!k);

export async function deleteProject(id: string) {
  const project = getProject(id);
  if (!project) return;
  // A beat that is gone takes its undo steps with it, and the takes they were holding on to.
  const held = songHistories.get(id);
  songHistories.delete(id);
  if (histories.delete(id)) keepHistories();
  update((l) => ({ ...l, projects: l.projects.filter((p) => p.id !== id), currentId: l.currentId === id ? null : l.currentId, songId: l.songId === id ? null : l.songId }));
  await Promise.all([...projectKeys(project), ...[...(held?.past ?? []), ...(held?.future ?? [])].flatMap((e) => e.holds ?? [])].map(dropBlob));
}

// ---------- Deleting a beat or a song, with a moment to take it back ----------

/** How long a deleted beat or song can be brought back. Its files stay on the device until then. */
export const REMOVED_SHOWN_MS = 7000;
type Removed = { project: Project; index: number; current: boolean; song: boolean; at: number };
let removed: Removed | null = null;
let removedTimer: ReturnType<typeof setTimeout> | null = null;

/** Lets go of the files of the beat or song deleted last, once it can no longer be brought back. */
async function settleRemoved() {
  const gone = removed;
  if (!gone) return;
  removed = null;
  if (removedTimer) clearTimeout(removedTimer);
  removedTimer = null;
  notify();
  const id = gone.project.id;
  // A beat that is gone takes its undo steps with it, and the takes they were holding on to.
  const held = songHistories.get(id);
  songHistories.delete(id);
  if (histories.delete(id)) keepHistories();
  await Promise.all([...projectKeys(gone.project), ...[...(held?.past ?? []), ...(held?.future ?? [])].flatMap((e) => e.holds ?? [])].map(dropBlob));
}

/**
 * Deletes a beat or a finished song at once, and keeps it in hand for a few seconds so the delete
 * can be undone where it happened. If the app is closed first, its files are cleared out the next time it opens.
 */
export function removeProject(id: string) {
  // Only the last delete can be taken back; an earlier one still waiting is finished first.
  void settleRemoved();
  const project = getProject(id);
  if (!project) return;
  removed = { project, index: library.projects.findIndex((p) => p.id === id), current: library.currentId === id, song: library.songId === id, at: Date.now() };
  for (const key of projectKeys(project)) toBin(key);
  update((l) => ({ ...l, projects: l.projects.filter((p) => p.id !== id), currentId: l.currentId === id ? null : l.currentId, songId: l.songId === id ? null : l.songId }));
  removedTimer = setTimeout(() => void settleRemoved(), REMOVED_SHOWN_MS + 500);
}

/** Puts back the beat or song deleted last, where it was in the list. */
export function restoreProject() {
  const back = removed;
  if (!back) return;
  removed = null;
  if (removedTimer) clearTimeout(removedTimer);
  removedTimer = null;
  update((l) => {
    if (l.projects.some((p) => p.id === back.project.id)) return l;
    const projects = [...l.projects];
    projects.splice(Math.min(back.index, projects.length), 0, back.project);
    return { ...l, projects, currentId: back.current ? back.project.id : l.currentId, songId: back.song ? back.project.id : l.songId };
  });
}

/** The beat or song deleted last, while it can still be brought back. */
export function useRemoved(): { name: string; finished: boolean; at: number } | null {
  const key = useSyncExternalStore(
    subscribe,
    () => (removed ? JSON.stringify([removed.project.name, !!removed.project.saved, removed.at]) : ''),
    () => '',
  );
  if (!key) return null;
  const [name, finished, at] = JSON.parse(key) as [string, boolean, number];
  return { name, finished, at };
}

/** Deletes a stored file unless something still uses it: a finished song shares its audio and cover with the beat it came from. */
export async function dropBlob(key: string) {
  // Nor one that an undo could still bring back.
  if (library.projects.some((p) => projectKeys(p).includes(key)) || heldKeys().has(key)) return;
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

export function addTake(projectId: string, recorded: Take, layer?: Layer['role']) {
  // A take recorded during a session is that artist's, and a song that was no one's becomes theirs with it.
  const artist = sessionArtist(library);
  const take: Take = artist && !recorded.artistId ? { ...recorded, artistId: artist.id } : recorded;
  const mine = (p: Project) => (artist && adopts(p) ? withArtist(p, artist) : null);
  // A take recorded as a layer joins the stack on the picked take instead of replacing it.
  if (layer) patchProject(projectId, (p) => ({ ...mine(p), takes: [...p.takes, take], layers: [...(p.layers ?? []), { takeId: take.id, role: layer, ...LAYER_START[layer] }] }));
  else patchProject(projectId, (p) => ({ ...mine(p), takes: [...p.takes, take], takeId: take.id }));
}

/** Whether a take lines up with the picked one bar for bar, so it can be layered on it or stand in for some of its bars. */
export const stacks = (lead: Take | null, other: Take) => !!lead && other.id !== lead.id && lead.phaseSec < 0.001 && other.phaseSec < 0.001 && other.loop.bars === lead.loop.bars && other.loop.startBar === lead.loop.startBar;

/** Changes the layers stacked on the picked take. `label` says what was done, for Undo; `group` ties together a run of changes to one control. */
export function setLayers(projectId: string, change: (layers: Layer[]) => Layer[], label = 'Changed the layers', group?: string) {
  const project = getProject(projectId);
  if (!project) return;
  const before = project.layers ?? [];
  const after = change(before);
  // Put back as they were, leaving out any whose take has gone since and keeping any added since.
  const restore = (to: Layer[], from: Layer[]) => (p: Project) => ({
    layers: [...to.filter((l) => p.takes.some((t) => t.id === l.takeId)), ...(p.layers ?? []).filter((l) => !to.some((x) => x.takeId === l.takeId) && !from.some((x) => x.takeId === l.takeId))],
  });
  note(projectId, { kind: 'layers', label, group: group && `layers:${group}`, quiet: !!group, back: restore(before, after), forth: restore(after, before) }, 900, 30000);
  patchProject(projectId, { layers: after });
}

const withBar = (bar: number, takeId: string | null | undefined) => (p: Project) => {
  const comp = { ...(p.comp ?? {}) };
  if (takeId && p.takes.some((t) => t.id === takeId)) comp[String(bar)] = takeId;
  else delete comp[String(bar)];
  return { comp };
};

/** Has one bar of the picked take play from another take, or from the picked take again when `takeId` is null. */
export function setCompBar(projectId: string, bar: number, takeId: string | null) {
  const project = getProject(projectId);
  if (!project) return;
  // Tapping a bar round its takes is one step back to where it started.
  note(projectId, { kind: 'bars', label: `Changed bar ${bar + 1}`, group: `bar:${bar}`, back: withBar(bar, project.comp?.[String(bar)] ?? null), forth: withBar(bar, takeId) }, 2500, 30000);
  patchProject(projectId, withBar(bar, takeId));
}

/**
 * Changes the lyrics. Typing is undone a stretch at a time: a new step starts after a pause,
 * at each new line, and every few seconds of unbroken typing.
 */
export function setLyrics(projectId: string, text: string) {
  const project = getProject(projectId);
  if (!project || project.lyrics === text) return;
  const before = project.lyrics;
  note(projectId, { kind: 'lyrics', label: 'Changed the lyrics', quiet: true, group: `lyrics:${text.split('\n').length}`, back: () => ({ lyrics: before }), forth: () => ({ lyrics: text }) }, 1500, 8000);
  patchProject(projectId, { lyrics: text });
}

const withoutTake = (takeId: string) => (p: Project) => {
  const takes = p.takes.filter((t) => t.id !== takeId);
  // Nothing keeps pointing at a take that is gone.
  const layers = (p.layers ?? []).filter((l) => l.takeId !== takeId);
  const comp = Object.fromEntries(Object.entries(p.comp ?? {}).filter(([, id]) => id !== takeId));
  return { takes, layers, comp, takeId: p.takeId === takeId ? (takes[takes.length - 1]?.id ?? null) : p.takeId };
};

/**
 * Deletes a take. It can be undone for the rest of the session, so its audio stays on the device
 * until then: it is cleared out once the delete can no longer be undone, or the next time the app opens.
 */
export function deleteTake(projectId: string, takeId: string) {
  const project = getProject(projectId);
  const take = project?.takes.find((t) => t.id === takeId);
  if (!project || !take) return;
  const layers = (project.layers ?? []).filter((l) => l.takeId === takeId);
  const comp = Object.fromEntries(Object.entries(project.comp ?? {}).filter(([, id]) => id === takeId));
  const picked = project.takeId === takeId;
  toBin(take.key);
  note(projectId, {
    kind: 'take',
    label: `Deleted take ${take.number}`,
    holds: [take.key],
    // The take goes back where it was in the list, with the layer and the bars it had, and picked if it was.
    back: (p) =>
      p.takes.some((t) => t.id === take.id)
        ? {}
        : {
            takes: [...p.takes, take].sort((a, b) => a.number - b.number),
            layers: [...(p.layers ?? []), ...layers.filter((l) => !(p.layers ?? []).some((x) => x.takeId === l.takeId))],
            comp: { ...comp, ...(p.comp ?? {}) },
            takeId: picked ? take.id : p.takeId,
          },
    forth: withoutTake(takeId),
  });
  patchProject(projectId, withoutTake(takeId));
}

/** The take a project is currently working with. */
export const activeTake = (p: Project | null) => p?.takes.find((t) => t.id === p.takeId) ?? null;
