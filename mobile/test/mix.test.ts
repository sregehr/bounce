// Undo that survives a reload, and the one mix a song has.
// Runs against the in-memory stand-in for storage (`src/data/db.ts`).
import { kv } from '../src/data/db';
import { matchKey, soundKey } from '../src/data/match';
import { oneMix } from '../src/data/songs';
import { emptyLibrary, type Beat, type Library, type MixSettings, type Take } from '../src/data/model';
import { UNDO_STEPS, addTake, createProject, deleteProject, flushHistories, getProject, loadLibrary, patchProject, redoMix, undoMix } from '../src/data/store';
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
/** The vocal level as it is in storage, once the write has gone through. */
const storedLevel = async (id: string) => (await sleep(1200), (await kv.get<Library>('library'))?.projects.find((p) => p.id === id)?.polish.vocalLevel);
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

  // ---------- One mix ----------
  const song = createProject(beat, 'Low tide');
  addTake(song.id, take(1));
  setLevel(song.id, 50);
  await sleep(750);
  setLevel(song.id, 80);
  check('a change to the mix is kept on the song as it is made', level(song.id) === 80 && (await storedLevel(song.id)) === 80, String(await storedLevel(song.id)));
  undoMix(song.id);
  check('and undo steps back to the mix before it', level(song.id) === 50);
  redoMix(song.id);
  // The beat by itself is the same song with no take picked: it has the same one mix, not a second.
  patchProject(song.id, { takeId: null }, false);
  check('mixing the beat alone keeps the same mix', level(song.id) === 80);
  patchProject(song.id, (p) => ({ master: { ...p.master, amount: 33 } }));
  patchProject(song.id, { takeId: 't1' }, false);
  check('and what was changed there is heard with the take too', getProject(song.id)!.master.amount === 33 && level(song.id) === 80);

  // A library from when a song could hold a second mix and mixes saved by name.
  const lib = (projects: object[]) => ({ ...emptyLibrary(), projects } as unknown as Library);
  const plain = getProject(song.id)!;
  const old = { ...plain, id: 'old', mixAlt: { polish: { ...plain.polish, vocalLevel: 10 }, master: plain.master, overrides: {} }, mixSide: 'B', mixAltLoud: { lufs: -9, ctx: 'x' }, snapshots: [{ id: 's', name: 'Mix 1', at: 1, mix: {} }] };
  const tidied = oneMix(lib([old, plain]));
  const left = tidied.projects[0] as unknown as Record<string, unknown>;
  check('a second mix and saved mixes are dropped from an older library', !('mixAlt' in left) && !('mixSide' in left) && !('mixAltLoud' in left) && !('snapshots' in left));
  check('the mix that was in use stays as it was', tidied.projects[0].polish.vocalLevel === 80 && tidied.projects[0].master.amount === 33);
  check('a song without them is left untouched', tidied.projects[1] === plain);
  const clean = lib([plain]);
  check('and a library with nothing to drop is returned as it is', oneMix(clean) === clean);

  // ---------- A stale measurement ----------
  const ctx = matchKey(getProject(song.id)!);
  rendered(song.id, -10);
  check('a loudness measured for the sound as it is now is current', getProject(song.id)!.statsOf === soundKey(getProject(song.id)!));
  setLevel(song.id, 51);
  check('a change to the mix makes it stale', getProject(song.id)!.statsOf !== soundKey(getProject(song.id)!));
  addTake(song.id, take(2));
  check('and so does picking another take', matchKey(getProject(song.id)!) !== ctx);

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
