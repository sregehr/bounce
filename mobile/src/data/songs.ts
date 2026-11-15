// Beats being worked on and finished songs live in one list. These are the rules that tell
// them apart, and that decide where the Song, mic and Mix tabs lead.
import { newId, type Library, type Profile, type Project } from './model';

export const beatsIn = (projects: Project[]) => projects.filter((p) => !p.saved);
export const songsIn = (projects: Project[]) => projects.filter((p) => p.saved).sort((a, b) => b.saved!.at - a.saved!.at);

/**
 * A finished song: its own copy of the chosen take and of every setting, so later work on the
 * beat leaves it alone. The audio and cover files are shared by key, not copied.
 */
export function makeSong(project: Project, title: string, now = Date.now()): Project {
  const take = project.takes.find((t) => t.id === project.takeId) ?? null;
  return { ...project, id: newId(), name: title.trim() || project.name, createdAt: now, updatedAt: now, takes: take ? [take] : [], takeId: take?.id ?? null, saved: { at: now, from: project.id } };
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

export type Hint = 'beat' | 'mix';
/** A screen to open, the project to make current first, and what to tell the user there. */
export type Lead = { to: '/' | '/vocals' | '/song' | '/playback'; id: string | null; hint?: Hint };

/** The mic always works: it records over a beat, or leads to adding one. */
export function micLead(l: Library): Lead {
  const beat = workBeat(l);
  return beat ? { to: '/vocals', id: beat.id } : { to: '/', id: null, hint: 'beat' };
}

/** Song always works: it opens the song being worked on, or leads to adding a beat to start one. */
export function songLead(l: Library): Lead {
  const beat = workBeat(l);
  return beat ? { to: '/song', id: beat.id } : { to: '/', id: null, hint: 'beat' };
}

/** Mix always works: it opens the mix of a beat with takes, or leads to recording one. */
export function mixLead(l: Library): Lead {
  const beat = workBeat(l);
  const recorded = beat?.takes.length ? beat : beatsIn(l.projects).find((p) => p.takes.length);
  if (recorded) return { to: '/playback', id: recorded.id };
  return beat ? { to: '/vocals', id: beat.id, hint: 'mix' } : { to: '/', id: null, hint: 'beat' };
}
