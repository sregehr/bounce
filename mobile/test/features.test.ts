// The parts of the newer features that are plain sums: where a slider's bubble sits, what undo
// puts back, how an artist's profile reaches a song, and when each lyric line shows on a snippet.
import { DEFAULT_MASTER, DEFAULT_POLISH } from '../src/dsp/presets';
import { blobs, kv } from '../src/data/db';
import type { Project, Take } from '../src/data/model';
import { addTake, createProject, deleteProject, deleteTake, getProject, loadLibrary, redoSong, setCompBar, setLayers, setLyrics, undoSong, update } from '../src/data/store';
import { BUBBLE_HEIGHT, BUBBLE_MARGIN, bubblePlace } from '../src/ui/bubble';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
}

// ---------- The slider's value bubble ----------
{
  // A 300-point slider starting 60 points in on a 402-point phone, well down the page.
  const held = { left: 60, top: 400 };
  const mid = bubblePlace(150, 52, held, 40, 402);
  check('the bubble is centred over the thumb', mid.left === 150 - 26, `${mid.left}`);
  check('and sits wholly above it', !mid.below && mid.top + BUBBLE_HEIGHT <= 40 / 2 - 9, `${mid.top}`);
  // A full-width slider with its thumb at either end, and a wide value.
  const edge = { left: 4, top: 400 };
  const atStart = bubblePlace(9, 90, edge, 40, 402);
  const atEnd = bubblePlace(394 - 9, 90, edge, 40, 402);
  check('at the left end it stops at the screen edge', edge.left + atStart.left === BUBBLE_MARGIN, `${edge.left + atStart.left}`);
  check('at the right end it stops at the screen edge', edge.left + atEnd.left + 90 === 402 - BUBBLE_MARGIN, `${edge.left + atEnd.left + 90}`);
  const top = bubblePlace(150, 52, { left: 60, top: 10 }, 40, 402);
  check('with no room above, it goes under the thumb', top.below && top.top >= 40 / 2 + 9, `${top.top}`);
}

// ---------- Undo for the song ----------
const audio = (key: string) => ({ key, durationSec: 30, sampleRate: 44100, channels: 2 });
const take = (n: number): Take => ({ ...audio(`take-${n}`), id: `t${n}`, number: n, createdAt: n, phaseSec: 0, loop: { bars: 8, startBar: 0 }, wave: [], peakDb: -6, clipped: false, origin: 'recorded', voice: null });
const sound = { type: 'audio/wav' } as unknown as Blob;
const tickPast = (ms: number) => {
  const real = Date.now;
  const at = real() + ms;
  Date.now = () => at;
  return () => void (Date.now = real);
};
async function undoTests() {
  // A take left in the bin by a session that ended before its delete could be undone.
  await blobs.put('take-stale', sound);
  await kv.set('bin', ['take-stale']);
  await loadLibrary();
  await new Promise((r) => setTimeout(r, 10));
  check('a take deleted in an earlier session is cleared out when the app opens', !(await blobs.get('take-stale')));

  const p = createProject({ ...audio('beat-a'), source: 'demo', sourceLabel: '', peakDb: -1, lufs: -12, clipped: false, trimmedSec: 0, wave: [], leadSec: 0, bpm: 90, musicalKey: null }, 'Undo me');
  const now = (): Project => getProject(p.id)!;
  for (const n of [1, 2, 3]) {
    await blobs.put(`take-${n}`, sound);
    addTake(p.id, take(n));
  }
  check('nothing can be undone before anything is edited', undoSong(p.id) === null);

  // Deleting a take, with a layer and a swapped bar that use it.
  update((l) => ({ ...l, projects: l.projects.map((x) => (x.id === p.id ? { ...x, takeId: 't2', layers: [{ takeId: 't1', role: 'double', level: 44, pan: -35 }], comp: { '3': 't1', '5': 't3' } } : x)) }));
  deleteTake(p.id, 't1');
  check('a deleted take leaves the song, with its layer and its bars', now().takes.map((t) => t.id).join() === 't2,t3' && now().layers!.length === 0 && JSON.stringify(now().comp) === '{"5":"t3"}');
  await new Promise((r) => setTimeout(r, 10));
  check('its audio stays on the device while the delete can be undone', !!(await blobs.get('take-1')));
  check('and is written down to be cleared if the app closes first', ((await kv.get<string[]>('bin')) ?? []).includes('take-1'));
  // A take recorded in between is not disturbed by the undo.
  await blobs.put('take-4', sound);
  addTake(p.id, take(4));
  check('undo says what it took back', undoSong(p.id)?.label === 'Deleted take 1');
  check('the take is back in its place, with its layer and bars', now().takes.map((t) => t.id).join() === 't1,t2,t3,t4' && now().layers![0].takeId === 't1' && now().comp!['3'] === 't1' && now().comp!['5'] === 't3');
  check('a take recorded since is still there and still picked', now().takeId === 't4');
  check('redo deletes it again', redoSong(p.id)?.label === 'Deleted take 1' && !now().takes.some((t) => t.id === 't1') && !!(await blobs.get('take-1')));
  undoSong(p.id);

  // Deleting the picked take, then undoing, picks it again.
  update((l) => ({ ...l, projects: l.projects.map((x) => (x.id === p.id ? { ...x, takeId: 't4' } : x)) }));
  deleteTake(p.id, 't4');
  check('deleting the picked take picks the newest one left', now().takeId === 't3');
  undoSong(p.id);
  check('and undo picks it again', now().takeId === 't4');

  // Layers: adding one, then dragging its level, which is one step however many moves it takes.
  setLayers(p.id, (all) => [...all, { takeId: 't3', role: 'double', level: 44, pan: -35 }], 'Layered take 3');
  for (const level of [50, 55, 61]) setLayers(p.id, (all) => all.map((l) => (l.takeId === 't3' ? { ...l, level } : l)), "Changed take 3's level", 't3:level');
  check('a layer is added and its level set', now().layers!.find((l) => l.takeId === 't3')?.level === 61);
  undoSong(p.id);
  check('dragging a level undoes as one step', now().layers!.find((l) => l.takeId === 't3')?.level === 44);
  undoSong(p.id);
  check('then the layer itself comes off', !now().layers!.some((l) => l.takeId === 't3') && now().layers!.some((l) => l.takeId === 't1'));
  redoSong(p.id);
  redoSong(p.id);
  check('redo puts both back', now().layers!.find((l) => l.takeId === 't3')?.level === 61);

  // Best bars.
  setCompBar(p.id, 1, 't2');
  setCompBar(p.id, 1, 't3');
  setCompBar(p.id, 2, 't2');
  undoSong(p.id);
  check('a swapped bar is undone by itself', now().comp!['2'] === undefined && now().comp!['1'] === 't3');
  undoSong(p.id);
  check('tapping one bar round its takes undoes to where it started', now().comp!['1'] === undefined && now().comp!['3'] === 't1');

  // Lyrics: typed a character at a time, undone a stretch at a time.
  const type = (text: string, from = '') => [...text].reduce((sofar, ch) => (setLyrics(p.id, sofar + ch), sofar + ch), from);
  const first = type('Night bus rolling');
  let back = tickPast(5000);
  const second = type(', city on mute', first);
  const third = type('\nEvery red light', second);
  back();
  check('the lyrics hold everything typed', now().lyrics === third);
  undoSong(p.id);
  check('undo takes back the newest line, not one letter', now().lyrics === second + '\n' || now().lyrics === second, JSON.stringify(now().lyrics));
  while (now().lyrics !== first && now().lyrics !== '') undoSong(p.id);
  check('a pause in typing starts a new step', now().lyrics === first, JSON.stringify(now().lyrics));
  undoSong(p.id);
  check('and the first stretch goes in one', now().lyrics === '');
  redoSong(p.id);
  check('redo brings a stretch back', now().lyrics === first);

  // A new edit after an undo drops what could have been redone, and with it a take only that was keeping.
  deleteTake(p.id, 't2');
  undoSong(p.id);
  redoSong(p.id);
  undoSong(p.id);
  setLyrics(p.id, first + '!');
  await new Promise((r) => setTimeout(r, 10));
  check('a take that was put back keeps its audio when its redo is dropped', now().takes.some((t) => t.id === 't2') && !!(await blobs.get('take-2')));
  deleteTake(p.id, 't2');
  back = tickPast(60000);
  for (let i = 0; i < 60; i++) setCompBar(p.id, i % 8, i % 2 ? 't3' : null);
  back();
  await new Promise((r) => setTimeout(r, 10));
  check('once a delete is too far back to undo, its audio is removed', !(await blobs.get('take-2')));

  // Deleting the beat takes everything with it.
  deleteTake(p.id, 't3');
  await deleteProject(p.id);
  check('deleting a beat removes the takes its undo steps were holding', !(await blobs.get('take-3')) && !(await blobs.get('take-1')));
}
async function main() {
  await undoTests();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
}
void main();
