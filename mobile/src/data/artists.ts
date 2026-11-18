// Artist profiles: the people recorded on this device, and how a profile reaches a song.
// Plain rules with no storage in them; the store applies them.
import type { Artist, Library, Project } from './model';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const artistsIn = (l: Pick<Library, 'artists'>): Artist[] => l.artists ?? [];
export const artistById = (l: Pick<Library, 'artists'>, id: string | null | undefined) => (id ? (artistsIn(l).find((a) => a.id === id) ?? null) : null);
/** The profile with this name, however it is capitalised. */
export const artistNamed = (l: Pick<Library, 'artists'>, name: string) => (name.trim() ? (artistsIn(l).find((a) => same(a.name, name)) ?? null) : null);
/** Who is at the mic for this session, if anyone has been picked. */
export const sessionArtist = (l: Pick<Library, 'artists' | 'sessionArtistId'>) => artistById(l, l.sessionArtistId);

/**
 * Names that are on songs but have no profile yet: songs from before profiles carry only the
 * name. They are offered wherever an artist is picked, and become a profile when chosen.
 */
export function namesWithoutProfile(l: Pick<Library, 'artists' | 'projects'>): string[] {
  const names: string[] = [];
  for (const p of l.projects) {
    const name = p.artist?.trim();
    if (name && !artistNamed(l, name) && !names.some((n) => same(n, name))) names.push(name);
  }
  return names;
}

/**
 * What changes on a song when an artist is put on it: their name, and their vocal chain and style
 * when they have one. A vocal chain already set by hand on a song that has takes is left alone:
 * someone shaped that sound on purpose.
 */
export function withArtist(p: Pick<Project, 'overrides' | 'polish' | 'takes'>, artist: Artist): Partial<Project> {
  const patch: Partial<Project> = { artist: artist.name, artistId: artist.id };
  if (artist.chain && (!p.overrides.vocal || p.takes.length === 0)) {
    patch.overrides = { ...p.overrides, vocal: artist.chain };
    if (artist.style) patch.polish = { ...p.polish, style: artist.style };
  }
  return patch;
}

/** Whether a session's artist takes over a song when they record on it: only a song that is no one's yet. */
export const adopts = (p: Pick<Project, 'artist' | 'saved'>) => !p.saved && !p.artist?.trim();
