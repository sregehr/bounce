// When each lyric line shows on a snippet video.
//
// Nothing in a song says when a word was sung: the lyrics are plain text and a take is plain
// audio. So the timing is worked out. The take's waveform shows where there is a voice and
// where there is not, and the lines are laid along the voiced stretches in order, each given
// time in proportion to how much there is to say in it, and started on a pause where one is near. The pace comes from the whole song (all
// the lyrics over all the singing), so a snippet from the middle starts on a line from the middle.
// It is a good first guess, not a transcript, which is why the Snippet screen lets a different
// first line be chosen and each line be nudged earlier or later.

/** A stretch of the song with a voice in it, in seconds. */
export type Stretch = { from: number; to: number };
/** A lyric line on the snippet: which line of the lyrics it is, and when it shows, in seconds from the snippet's start. */
export type TimedLine = { index: number; text: string; at: number; until: number };
export type LineChoice = { first?: number | null; shift?: Record<string, number> };

/** How far one tap moves a line. */
export const NUDGE_SEC = 0.25;
/** A line stays up at least this long, so it can be read. */
const SHORTEST = 1.2;
/** After the singing a line was matched to ends, the line lingers this long, then clears. */
const LINGER = 0.8;

/** The lines of the lyrics that have words in them. */
export const lyricLines = (lyrics: string) => lyrics.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Where the voice is, from the take's waveform. `peaks` are levels (any scale) in slices of
 * `binSec`. A slice counts as voiced when it stands clear of the take's own quiet level, so
 * room noise and a little of the beat leaking into the mic are not taken for singing. Short
 * gaps, such as a breath or the space between words, do not split a stretch.
 */
export function voicedStretches(peaks: number[], binSec: number): Stretch[] {
  const top = peaks.reduce((m, p) => Math.max(m, p), 0);
  if (top <= 0 || binSec <= 0) return [];
  const sorted = [...peaks].sort((a, b) => a - b);
  const quiet = sorted[Math.floor(sorted.length * 0.2)] / top;
  const threshold = Math.min(0.5, Math.max(0.06, quiet * 2.5 + 0.03)) * top;
  const out: Stretch[] = [];
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] < threshold) continue;
    const from = i * binSec, to = (i + 1) * binSec;
    const last = out[out.length - 1];
    if (last && from - last.to <= 0.35) last.to = to;
    else out.push({ from, to });
  }
  // A click or a cough is not a line.
  return out.filter((s) => s.to - s.from >= 0.2);
}

/** How much there is to say in a line: its letters and digits, with a floor so a one-word line still gets a moment. */
const weight = (line: string) => Math.max(6, line.replace(/[^\p{L}\p{N}]/gu, '').length);

const voicedBefore = (stretches: Stretch[], t: number) => stretches.reduce((sum, s) => sum + Math.max(0, Math.min(t, s.to) - s.from), 0);
/** The moment by which `v` seconds of voice have gone by, or null when the song has less voice than that. */
function momentAt(stretches: Stretch[], v: number): number | null {
  let left = v;
  for (const s of stretches) {
    const span = s.to - s.from;
    if (left < span) return s.from + left;
    left -= span;
  }
  return null;
}

/**
 * The lines to show on a snippet that runs from `start` for `length` seconds, and when.
 * `stretches` is where the voice is across the whole song, and `duration` the song's length.
 * `choice.first` is a line picked by hand to open the snippet (by its place in the lyrics);
 * without one it is the line the song has reached by then. `choice.shift` moves single lines,
 * in seconds, keyed by their place in the lyrics.
 */
export function timeLines(lines: string[], stretches: Stretch[], duration: number, start: number, length: number, choice: LineChoice = {}): TimedLine[] {
  if (lines.length === 0 || length <= 0) return [];
  // With no voice to go by (an instrumental, or a silent take), the lines are spread evenly.
  const voice = stretches.length ? stretches : [{ from: 0, to: Math.max(duration, start + length) }];
  const total = voicedBefore(voice, Infinity);
  const weights = lines.map(weight);
  const all = weights.reduce((a, b) => a + b, 0);
  // Seconds of voice per letter. If the lyrics are longer than the singing, lines keep a readable length and the last ones go unused.
  const pace = Math.max(total / all, SHORTEST / (all / lines.length));
  const end = start + length;
  const before = voicedBefore(voice, start);

  let first = choice.first ?? null;
  if (first === null || first < 0 || first >= lines.length) {
    // The line the song has reached when the snippet starts; if that line is mostly over, the next one.
    let sung = 0;
    first = lines.length - 1;
    for (let i = 0; i < lines.length; i++) {
      const span = weights[i] * pace;
      if (before < sung + span) {
        first = before - sung > span * 0.6 && i < lines.length - 1 ? i + 1 : i;
        break;
      }
      sung += span;
    }
  }

  const out: TimedLine[] = [];
  let voiced = before;
  for (let i = first; i < lines.length; i++) {
    const span = weights[i] * pace;
    let from = momentAt(voice, voiced);
    if (from === null) break;
    // People breathe between lines, so a pause in the voice is most likely where a line ends. A
    // line that would start just before a pause waits for the voice to come back, and one that
    // would start just after it starts with it.
    const slack = Math.min(1, span * 0.35);
    const here = voice.findIndex((s) => from! >= s.from && from! < s.to);
    if (out.length && here >= 0) {
      const s = voice[here];
      if (s.to - from < slack && here + 1 < voice.length) from = voice[here + 1].from;
      else if (from - s.from < slack && out[out.length - 1].at + start < s.from) from = s.from;
      voiced = voicedBefore(voice, from);
    }
    if (from >= end - 0.3) break;
    // The first line is up from the start of the snippet if the voice is already going.
    let at = Math.max(start, from) + (choice.shift?.[String(i)] ?? 0);
    const earliest = out.length ? out[out.length - 1].at + start + 0.3 : start;
    at = Math.min(end - 0.3, Math.max(earliest, at));
    const sungBy = momentAt(voice, voiced + span) ?? voice[voice.length - 1].to;
    out.push({ index: i, text: lines[i], at: at - start, until: Math.min(end, Math.max(at + SHORTEST, sungBy + LINGER)) - start });
    voiced += span;
  }
  // A line gives way to the next one as soon as that starts.
  for (let i = 0; i < out.length - 1; i++) out[i].until = Math.min(Math.max(out[i].until, out[i].at + 0.3), out[i + 1].at);
  for (let i = 0; i < out.length - 1; i++) if (out[i + 1].at - out[i].until < 0.4) out[i].until = out[i + 1].at;
  return out;
}

/** The line on show at a moment in the snippet, or null between lines. */
export const lineAt = (lines: TimedLine[], t: number) => lines.find((l) => t >= l.at && t < l.until) ?? null;
