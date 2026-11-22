// Beats being worked on and finished songs live in one list. These are the rules that tell
// them apart, and that decide where the Song, mic and Mix tabs lead.
import { newId, type Library, type Profile, type Project } from './model';

export const beatsIn = (projects: Project[]) => projects.filter((p) => !p.saved);
/**
 * Beats still being worked on, which is what Home lists: ones with no song in the Vault yet,
 * and ones with a take recorded since their last song went in. A beat that is done stays in
 * the library and is reached from its song in the Vault.
 */
export function activeBeats(projects: Project[]): Project[] {
  const lastSaved = new Map<string, number>();
  for (const p of projects) if (p.saved) lastSaved.set(p.saved.from, Math.max(lastSaved.get(p.saved.from) ?? 0, p.saved.at));
  return beatsIn(projects).filter((beat) => {
    const at = lastSaved.get(beat.id);
    return at === undefined || beat.takes.some((take) => take.createdAt > at);
  });
}
/**
 * Where a beat stands, in a few words: what Home's rows and the song switcher say about it.
 * A beat with a song in the Vault only counts as having new work when a take is newer than that song.
 */
export function stageOf(beat: Project, projects: Project[]): string {
  const n = beat.takes.length;
  if (n === 0) return 'No takes yet';
  const takes = `${n} ${n === 1 ? 'take' : 'takes'}`;
  const saved = projects.filter((p) => p.saved?.from === beat.id).map((p) => p.saved!.at);
  if (saved.length === 0) return `${takes} · ready to mix`;
  const last = Math.max(...saved);
  return beat.takes.some((take) => take.createdAt > last) ? 'In the Vault · new takes' : 'In the Vault';
}

export const songsIn = (projects: Project[]) => projects.filter((p) => p.saved).sort((a, b) => b.saved!.at - a.saved!.at);

/**
 * A finished song: its own copy of the chosen take and of every setting, so later work on the
 * beat leaves it alone. The audio and cover files are shared by key, not copied.
 */
export function makeSong(project: Project, title: string, now = Date.now()): Project {
  const take = project.takes.find((t) => t.id === project.takeId) ?? null;
  // The takes stacked on the chosen one, and those its best bars play from, are part of the song too.
  const heard = new Set(take ? [take.id, ...partsOf(project)] : []);
  return { ...project, id: newId(), name: title.trim() || project.name, createdAt: now, updatedAt: now, takes: project.takes.filter((t) => heard.has(t.id)), takeId: take?.id ?? null, saved: { at: now, from: project.id } };
}

/** The takes a song plays besides its chosen one: its layers, and the takes its best bars come from. */
const partsOf = (p: Project) => [...(p.layers ?? []).map((l) => l.takeId), ...Object.values(p.comp ?? {})];

/**
 * Finished songs used to keep only their chosen take, so their layers and best bars fell silent.
 * Where the beat a song was made from still has those takes, they are given back to the song.
 */
export function mendSongs(l: Library): Library {
  let mended = false;
  const projects = l.projects.map((song) => {
    if (!song.saved) return song;
    const has = new Set(song.takes.map((t) => t.id));
    const missing = new Set(partsOf(song).filter((id) => !has.has(id)));
    if (missing.size === 0 || !has.has(song.takeId ?? '')) return song;
    const found = l.projects.find((p) => p.id === song.saved!.from && !p.saved)?.takes.filter((t) => missing.has(t.id)) ?? [];
    if (found.length === 0) return song;
    mended = true;
    // The numbers kept from its last master were of the song without them.
    return { ...song, takes: [...song.takes, ...found], stats: null };
  });
  return mended ? { ...l, projects } : l;
}

/** The name a song goes out under: the artist it features, or else the name in Settings. */
export const artistOf = (project: Pick<Project, 'artist'>, profile: Pick<Profile, 'artist'>) => project.artist?.trim() || profile.artist || 'You';

/**
 * The Vault used to list every take. Now it holds finished songs only, so on the first launch
 * afterwards anything that was plainly being finished (a cover, lyrics or a snippet) is saved
 * into it. Everything else stays on its beat.
 */
export function carryOver(l: Library): Library {
  if (l.vault) return l;
  const done = l.projects.filter((p) => !p.saved && p.takes.some((t) => t.id === p.takeId) && (p.cover.imageKey || p.snippet.made || p.lyrics.trim()));
  return { ...l, vault: 1, projects: [...done.map((p) => makeSong(p, p.name, p.updatedAt)), ...l.projects] };
}

/** The beat the mic records over: the one being worked on, or the one the loaded song was made from. */
export function workBeat(l: Library): Project | null {
  const current = l.projects.find((p) => p.id === l.currentId);
  if (current && !current.saved) return current;
  const from = current?.saved ? l.projects.find((p) => p.id === current.saved!.from && !p.saved) : null;
  return from ?? beatsIn(l.projects)[0] ?? null;
}

/** The finished song played last, or the newest one when none has been. */
export function loadedSong(l: Library): Project | null {
  const songs = songsIn(l.projects);
  return songs.find((s) => s.id === l.songId) ?? songs[0] ?? null;
}

/** A screen to open, and the project to make current first. */
export type Lead = { to: '/vocals' | '/song' | '/playback'; id: string | null };

/** The mic always works: it records over a beat. With no beat, its screen offers the ways to add one. */
export function micLead(l: Library): Lead {
  const beat = workBeat(l);
  return beat ? { to: '/vocals', id: beat.id } : { to: '/vocals', id: null };
}

/** Song always works: it opens the song being worked on. With no beat, its screen offers the ways to add one. */
export function songLead(l: Library): Lead {
  const beat = workBeat(l);
  return beat ? { to: '/song', id: beat.id } : { to: '/song', id: null };
}

/** Mix always works, and always on the song being worked on: its takes, or its beat alone when nothing is recorded yet. With no beat, its screen offers the ways to add one. */
export function mixLead(l: Library): Lead {
  const beat = workBeat(l);
  return { to: '/playback', id: beat?.id ?? null };
}
