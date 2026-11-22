// Names for the sound of a song as it is set now, so numbers measured from an earlier sound can be told apart as stale.
import type { MixSettings, Project } from './model';

/** A short, stable stand-in for a long string. */
function hash(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Everything apart from the mix settings that changes how loud a song comes out: the beat, the take, its layers and best bars. */
export function matchKey(p: Project) {
  const take = p.takes.find((t) => t.id === p.takeId) ?? null;
  return hash(JSON.stringify([p.beat.key, p.beat.bpm, take?.id ?? null, take?.loop ?? null, p.layers ?? null, p.comp ?? null]));
}

/** Names the sound of a song as it is set now, so a loudness measured earlier can be told from a stale one. */
export function soundKey(p: Project) {
  const mix: MixSettings = { polish: p.polish, master: p.master, overrides: p.overrides, space: p.space };
  return `${hash(JSON.stringify(mix))}:${matchKey(p)}`;
}
