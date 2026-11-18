// Undo that survives a reload, mixes saved by name, and matching the level of two mixes being compared.
// Runs against the in-memory stand-in for storage (`src/data/db.ts`).
import { kv } from '../src/data/db';
import { MATCH_LIMIT_DB, matchKey, matchNote, matchTrim, soundKey } from '../src/data/match';
import { emptyLibrary, type Beat, type Library, type MixSettings, type Take } from '../src/data/model';
import { SNAPSHOT_LIMIT, UNDO_STEPS, addTake, compareSnapshot, createProject, deleteProject, deleteSnapshot, flushHistories, getProject, loadLibrary, loudnessOf, patchProject, redoMix, renameSnapshot, restoreSnapshot, saveSnapshot, switchMix, undoMix } from '../src/data/store';
import { twoFingerTap } from '../src/ui/twoFingerTap';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const beat: Beat = { key: 'beat-1', durationSec: 30, sampleRate: 44100, channels: 2, source: 'demo', sourceLabel: '', peakDb: -1, lufs: -12, clipped: false, trimmedSec: 0, wave: [], leadSec: 0, bpm: 90, musicalKey: null };
const take = (n: number): Take => ({ key: `take-${n}`, durationSec: 5, sampleRate: 44100, channels: 1, id: `t${n}`, number: n, createdAt: n, phaseSec: 0, loop: { bars: 0, startBar: 0 }, wave: [], peakDb: -6, clipped: false, origin: 'recorded', voice: null });
const level = (id: string) => getProject(id)!.polish.vocalLevel;
const setLevel = (id: string, vocalLevel: number) => patchProject(id, (p) => ({ polish: { ...p.polish, vocalLevel } }));
/** Stands in for a render finishing: the loudness it measured, for the sound as it is now. */
const rendered = (id: string, lufs: number) => patchProject(id, (p) => ({ stats: { lufs, truePeakDb: -1, durationSec: 30 }, statsOf: soundKey(p) }), false);

const run = async () => {
  // ---------- Undo across a reload ----------
  // What an earlier session left behind: a song, and two steps of undo for it. A song that is gone has steps too.
  const earlier = createProject(beat, 'Night bus');
  const was: MixSettings = { polish: { ...earlier.polish, vocalLevel: 40 }, master: earlier.master, overrides: earlier.overrides, space: earlier.space };
  const saved: Library = { ...emptyLibrary(), vault: 1, profile: { artist: 'Kai', producer: '', onboarded: true }, projects: [{ ...earlier, polish: { ...earlier.polish, vocalLevel: 60 } }], currentId: earlier.id };
  await kv.set('library', saved);
  await kv.set('undo:mix', { [earlier.id]: { past: [{ ...was, polish: { ...was.polish, vocalLevel: 20 } }, was], future: [] }, gone: { past: [was], future: [] } });
  await loadLibrary();
  await sleep(20);
  const id = earlier.id;
  check('undo steps from before a reload are there again', undoMix(id) === true);
  check('and none are kept for a song that is gone', undoMix('gone') === false);
  check('undo steps back to the mix before the reload', level(id) === 40, String(level(id)));
  undoMix(id);
  check('and again to the one before that', level(id) === 20, String(level(id)));
  check('then there is nothing more to undo', undoMix(id) === false);
  redoMix(id);
  redoMix(id);
  check('redo comes forward again', level(id) === 60 && redoMix(id) === false, String(level(id)));

  // A new change is written down, and so is taking it back.
  setLevel(id, 75);
  await flushHistories();
  type Kept = Record<string, { past: MixSettings[]; future: MixSettings[] }>;
  let kept = (await kv.get<Kept>('undo:mix'))!;
  check('a change to the mix is written down as a step', kept[id].past.at(-1)?.polish.vocalLevel === 60 && kept[id].future.length === 0, JSON.stringify(kept[id].past.map((m) => m.polish.vocalLevel)));
  check('the steps of the song that is gone are dropped', !('gone' in kept));
  undoMix(id);
  await flushHistories();
  kept = (await kv.get<Kept>('undo:mix'))!;
  check('an undo is written down too, with the way forward', kept[id].future.at(-1)?.polish.vocalLevel === 75);

  // The number of steps is capped.
  for (let i = 0; i < UNDO_STEPS + 10; i++) {
    setLevel(id, i);
    await sleep(0);
    // Changes in quick succession count as one, so each of these is spaced out by being stepped back and forth.
    undoMix(id);
    redoMix(id);
  }
  await flushHistories();
  kept = (await kv.get<Kept>('undo:mix'))!;
  check(`no more than ${UNDO_STEPS} steps are kept for a song`, kept[id].past.length <= UNDO_STEPS && kept[id].past.length > 10, String(kept[id].past.length));

  // ---------- Saved mixes ----------
  const song = createProject(beat, 'Low tide');
  addTake(song.id, take(1));
  setLevel(song.id, 50);
  rendered(song.id, -10);
  const first = saveSnapshot(song.id)!;
  check('a saved mix gets the next free name', first.name === 'Mix 1', first.name);
  check('and remembers how loud it measured', first.loud?.lufs === -10);
  await sleep(750);
  setLevel(song.id, 80);
  const second = saveSnapshot(song.id, '  Loud vocal  ')!;
  check('a name given to a saved mix is trimmed', second.name === 'Loud vocal');
  check('a mix that has not been rendered yet is saved without a loudness', second.loud === undefined);
  check('the newest saved mix is listed first', getProject(song.id)!.snapshots!.map((m) => m.name).join() === 'Loud vocal,Mix 1');
  restoreSnapshot(song.id, first.id);
  check('using a saved mix makes it the mix in use', level(song.id) === 50);
  undoMix(song.id);
  check('and undo takes that back', level(song.id) === 80, String(level(song.id)));
  renameSnapshot(song.id, first.id, 'Dry');
  renameSnapshot(song.id, second.id, '   ');
  check('a saved mix can be renamed, but not to nothing', getProject(song.id)!.snapshots!.map((m) => m.name).join() === 'Loud vocal,Dry');
  compareSnapshot(song.id, first.id);
  check('comparing puts the saved mix on the other side, with its loudness', getProject(song.id)!.mixAlt?.polish.vocalLevel === 50 && getProject(song.id)!.mixAltLoud?.lufs === -10 && level(song.id) === 80);
  rendered(song.id, -8);
  switchMix(song.id, 'B');
  check('flipping to it plays the saved mix', level(song.id) === 50 && getProject(song.id)!.mixSide === 'B');
  check('and the mix left behind takes its loudness with it', getProject(song.id)!.mixAltLoud?.lufs === -8);
  deleteSnapshot(song.id, first.id);
  check('deleting a saved mix leaves the mix in use alone', getProject(song.id)!.snapshots!.length === 1 && level(song.id) === 50);
  for (let i = 0; i < SNAPSHOT_LIMIT + 3; i++) saveSnapshot(song.id);
  check(`a song keeps at most ${SNAPSHOT_LIMIT} saved mixes`, getProject(song.id)!.snapshots!.length === SNAPSHOT_LIMIT && saveSnapshot(song.id) === null);
  check('saved mixes get names that are not taken', new Set(getProject(song.id)!.snapshots!.map((m) => m.name)).size === SNAPSHOT_LIMIT);

  // ---------- Matching levels ----------
  const now = getProject(song.id)!;
  const ctx = matchKey(now);
  check('the louder mix is turned down to the quieter one', matchTrim(-8, { lufs: -10, ctx }, ctx) === -2);
  check('the quieter mix is left alone', matchTrim(-10, { lufs: -8, ctx }, ctx) === 0);
  check('a difference too small to hear is left alone', matchTrim(-9.95, { lufs: -10, ctx }, ctx) === 0);
  check('a mix is never turned down by more than the limit', matchTrim(-3, { lufs: -30, ctx }, ctx) === -MATCH_LIMIT_DB);
  check('nothing is matched until both have been measured', matchTrim(-8, undefined, ctx) === null && matchTrim(null, { lufs: -10, ctx }, ctx) === null);
  check('or when the other was measured with a different take', matchTrim(-8, { lufs: -10, ctx: 'other' }, ctx) === null);
  check('silence is not something to match to', matchTrim(-8, { lufs: -Infinity, ctx }, ctx) === null);
  addTake(song.id, take(2));
  check('picking another take makes an earlier measurement stale', matchKey(getProject(song.id)!) !== ctx);
  check('and the loudness of the mix in use is unknown until it renders again', loudnessOf(getProject(song.id)!) === undefined);
  rendered(song.id, -9);
  check('once rendered it is known again', loudnessOf(getProject(song.id)!)?.lufs === -9);
  setLevel(song.id, 51);
  check('a change to the mix makes it unknown again', loudnessOf(getProject(song.id)!) === undefined);
  check('the note says when levels are still to be matched', matchNote(null, 'A').startsWith('Play both mixes once'));
  check('and by how much the louder one is turned down', matchNote(-1.5, 'B') === 'Levels matched: Mix B plays 1.5 dB quieter here. Exports are not changed.');

  // ---------- Deleting a song ----------
  await deleteProject(id);
  await flushHistories();
  check('a deleted song takes its undo steps with it', !(id in ((await kv.get<Kept>('undo:mix')) ?? {})));

  // ---------- Two-finger tap ----------
  const a = { id: 1, x: 100, y: 100 };
  const b = { id: 2, x: 160, y: 110 };
  let feed = twoFingerTap();
  feed('start', [a], 0);
  feed('start', [a, b], 20);
  feed('end', [b], 120);
  check('two fingers down and up is a tap', feed('end', [], 140) === true);
  feed = twoFingerTap();
  feed('start', [a], 0);
  check('one finger is not', feed('end', [], 80) === false);
  feed = twoFingerTap();
  feed('start', [a, b], 0);
  feed('move', [a, { ...b, y: 180 }], 60);
  feed('end', [a], 100);
  check('two fingers sliding is a scroll or a pinch, not a tap', feed('end', [], 120) === false);
  feed = twoFingerTap();
  feed('start', [a, b], 0);
  feed('end', [a], 500);
  check('two fingers held is not a tap', feed('end', [], 520) === false);
  feed = twoFingerTap();
  feed('start', [a, b], 0);
  feed('start', [a, b, { id: 3, x: 200, y: 100 }], 30);
  feed('end', [], 100);
  feed('start', [a, b], 1000);
  feed('end', [a], 1080);
  check('three fingers are not, and the next two-finger tap still counts', feed('end', [], 1100) === true);
  feed = twoFingerTap();
  feed('start', [a, b], 0);
  feed('cancel', [], 50);
  check('a gesture the system took over is not a tap', feed('end', [], 80) === false);

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
};
run();
