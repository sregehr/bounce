// Matching the level of two mixes while they are compared, so the louder one does not win
// just by being louder. Only what is heard on the Mix page is turned down; exports are untouched.
import type { Loudness, MixSettings, Project } from './model';

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

/** The most a mix is turned down to meet the other. Beyond this the two are different enough that matching would mislead. */
export const MATCH_LIMIT_DB = 12;

/**
 * How far to turn the mix in use down, in dB (zero or below), so it is no louder than the other
 * one. Null when either has not been measured with the take that is on now.
 */
export function matchTrim(current: number | null | undefined, other: Loudness | undefined, ctx: string): number | null {
  if (current == null || !Number.isFinite(current) || !other || other.ctx !== ctx || !Number.isFinite(other.lufs)) return null;
  const over = current - other.lufs;
  // A tenth of a dB cannot be heard, and would only make the level flicker.
  if (over < 0.1) return 0;
  return -Math.min(MATCH_LIMIT_DB, Math.round(over * 10) / 10);
}

/** What the Mix page says under Mix A and Mix B about their levels. */
export function matchNote(trimDb: number | null, side: 'A' | 'B') {
  if (trimDb === null) return 'Play both mixes once and their levels are matched, so the louder one does not win by being louder.';
  if (trimDb === 0) return 'Levels matched. Exports are not changed.';
  return `Levels matched: Mix ${side} plays ${Math.abs(trimDb).toFixed(1)} dB quieter here. Exports are not changed.`;
}
