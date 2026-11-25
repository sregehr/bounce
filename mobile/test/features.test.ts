// The parts of the newer features that are plain sums: where a slider's bubble sits, what undo
// puts back, how an artist's profile reaches a song, and when each lyric line shows on a snippet.
import { DEFAULT_POLISH } from '../src/dsp/presets';
import { artistNamed, namesWithoutProfile, recentArtists, withArtist } from '../src/data/artists';
import { blobs, kv } from '../src/data/db';
import type { Project, Take } from '../src/data/model';
import { addTake, createProject, deleteProject, deleteTake, getLibrary, getProject, loadLibrary, redoSong, removeArtist, renameArtist, saveArtist, setArtistSound, setCompBar, setLayers, setLyrics, setSession, undoSong, update } from '../src/data/store';
import { artistOf } from '../src/data/songs';
import { lineAt, lyricLines, timeLines, voicedStretches } from '../src/snippet/lyricTiming';
import { wordsBox } from '../src/snippet/video.web';
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
// ---------- Artist profiles and sessions ----------
async function artistTests() {
  const beat = (key: string) => ({ ...audio(key), source: 'demo' as const, sourceLabel: '', peakDb: -1, lufs: -12, clipped: false, trimmedSec: 0, wave: [], leadSec: 0, bpm: 90, musicalKey: null });
  const now = (id: string): Project => getProject(id)!;
  const chain = { eq: [{ type: 'peaking' as const, freq: 3000, gain: 2, q: 1 }], comp: { threshold: -22, ratio: 4, attack: 8, release: 90, makeup: 3 }, deess: { freq: 6500, amount: 4 }, limiter: { ceiling: -1, release: 80 } };

  // A song from before profiles has only a name on it, and still goes out under it.
  const old = createProject(beat('beat-old'), 'Old song');
  update((l) => ({ ...l, projects: l.projects.map((p) => (p.id === old.id ? { ...p, artist: 'Mina Cole' } : p)) }));
  check('a song with only a name still goes out under it', artistOf(now(old.id), { artist: 'Kai' }) === 'Mina Cole' && now(old.id).artistId === undefined);
  check('and the name is offered where an artist is picked', namesWithoutProfile(getLibrary()).join() === 'Mina Cole');

  let mina = saveArtist('  Mina Cole ')!;
  check('saving a profile for that name joins the old song to it', now(old.id).artistId === mina.id && now(old.id).artist === 'Mina Cole');
  check('the same name, however it is typed, is the same artist', saveArtist('MINA COLE')!.id === mina.id && (getLibrary().artists ?? []).length === 1 && artistNamed(getLibrary(), 'Mina cole')?.id === mina.id);
  check('a name with nothing in it is not an artist', saveArtist('   ') === null);
  check('once it has a profile the name is no longer a loose one', namesWithoutProfile(getLibrary()).length === 0);

  // Their sound, saved the way a preset is, and what a session does with it.
  setArtistSound(mina.id, chain, 'Melodic');
  mina = artistNamed(getLibrary(), 'Mina Cole')!;
  setSession(mina.id);
  const fresh = createProject(beat('beat-new'), 'New song');
  check('a beat added during a session is that artist\'s song', now(fresh.id).artist === 'Mina Cole' && now(fresh.id).artistId === mina.id);
  check('and starts with their vocal chain and style', JSON.stringify(now(fresh.id).overrides.vocal) === JSON.stringify(chain) && now(fresh.id).polish.style === 'Melodic');

  // A song that is no one's becomes theirs when they record on it.
  setSession(null);
  const loose = createProject(beat('beat-loose'), 'Loose song');
  check('with no session a new song is no one\'s', now(loose.id).artist === undefined && now(loose.id).overrides.vocal === undefined);
  setSession(mina.id);
  addTake(loose.id, take(1));
  check('a take recorded in a session carries the artist', now(loose.id).takes[0].artistId === mina.id);
  check('and a song that was no one\'s becomes theirs, with their sound', now(loose.id).artist === 'Mina Cole' && JSON.stringify(now(loose.id).overrides.vocal) === JSON.stringify(chain));

  // Someone else's song is left alone, and so is a vocal chain shaped by hand.
  const jay = saveArtist('Jay Oh')!;
  setSession(jay.id, loose.id);
  addTake(loose.id, take(2));
  check('recording on another artist\'s song leaves the song theirs', now(loose.id).artist === 'Mina Cole' && now(loose.id).takes[1].artistId === jay.id);
  const hand = { ...chain, comp: { ...chain.comp, ratio: 2 } };
  const shaped = withArtist({ overrides: { vocal: hand }, polish: DEFAULT_POLISH, takes: [take(1)] }, mina);
  check('a vocal chain set by hand on a song with takes is kept', shaped.overrides === undefined && shaped.artist === 'Mina Cole');
  const untouched = withArtist({ overrides: { vocal: hand }, polish: DEFAULT_POLISH, takes: [] }, mina);
  check('before any take, the artist\'s chain replaces it', JSON.stringify(untouched.overrides?.vocal) === JSON.stringify(chain));
  check('an artist with no saved sound changes only the name', Object.keys(withArtist({ overrides: {}, polish: DEFAULT_POLISH, takes: [] }, jay)).sort().join() === 'artist,artistId');

  // Picking an artist on a song that has no takes yet makes it theirs straight away.
  setSession(null);
  const empty = createProject(beat('beat-empty'), 'Empty song');
  setSession(jay.id, empty.id);
  check('picking who is on the mic puts them on a song with no takes', now(empty.id).artist === 'Jay Oh');

  // Names are typed where they are used; the last few are offered, and one nobody recorded under is dropped.
  check('the people recorded most recently are offered, each once', recentArtists(getLibrary()).slice().sort().join() === 'Jay Oh,Mina Cole' && recentArtists(getLibrary(), 1).length === 1);
  const typo = saveArtist('Jya')!;
  setSession(typo.id);
  check('a name just typed is offered first', recentArtists(getLibrary())[0] === 'Jya');
  setSession(jay.id);
  check('a name changed before anything was recorded under it is forgotten', !artistNamed(getLibrary(), 'Jya') && !!artistNamed(getLibrary(), 'Mina Cole') && !recentArtists(getLibrary()).includes('Jya'));
  setSession(null);

  renameArtist(mina.id, 'Mina C');
  check('renaming an artist renames their songs', now(old.id).artist === 'Mina C' && now(fresh.id).artist === 'Mina C');
  removeArtist(jay.id);
  check('removing an artist ends their session and leaves their songs named', getLibrary().sessionArtistId === null && now(empty.id).artist === 'Jay Oh' && now(empty.id).artistId === undefined);
  setSession(null);
}

// ---------- Lyric lines in time on a snippet ----------
function lyricTests() {
  check('blank lines in the lyrics are not lines', lyricLines('One\n\n  Two  \n').join('|') === 'One|Two');

  // A take in slices of 50 ms: room noise throughout, a voice from 2 s to 6 s with a breath in it, and again from 10 s to 14 s.
  const bin = 0.05;
  const level = (t: number) => ((t >= 2 && t < 3.9) || (t >= 4.1 && t < 6) || (t >= 10 && t < 14) ? 0.6 + 0.3 * Math.sin(t * 40) ** 2 : t >= 8 && t < 8.1 ? 0.9 : 0.02);
  const peaks = Array.from({ length: Math.round(16 / bin) }, (_, i) => level(i * bin));
  const voice = voicedStretches(peaks, bin);
  const near = (a: number, b: number, by = 0.11) => Math.abs(a - b) <= by;
  check('the voice is found where it is, across a breath', voice.length === 2 && near(voice[0].from, 2) && near(voice[0].to, 6) && near(voice[1].from, 10) && near(voice[1].to, 14), JSON.stringify(voice));
  check('silence has no voice in it', voicedStretches(new Array(200).fill(0), bin).length === 0);
  check('steady noise with nothing over it is not a voice', voicedStretches(new Array(200).fill(0.3), bin).length <= 1);

  // Four lines of about the same length over eight seconds of singing: two to each stretch.
  const lines = ['Night bus rolling city on mute', 'Every red light is a breath I use', 'Window seat and the world goes by', 'Counting every stop until its mine'];
  const whole = timeLines(lines, voice, 16, 0, 16);
  check('every line gets a place, in order', whole.length === 4 && whole.every((l, i) => l.index === i && (i === 0 || l.at > whole[i - 1].at)), JSON.stringify(whole.map((l) => l.at)));
  check('the first line starts with the voice, not with the snippet', near(whole[0].at, 2));
  check('lines are laid along the singing, skipping the gap', whole[1].at > 3 && whole[1].at < 5.5 && near(whole[2].at, 10, 0.6) && whole[3].at > 11 && whole[3].at < 13.5, JSON.stringify(whole.map((l) => l.at)));
  check('a line clears a moment after its singing stops, not at the next line', whole[1].until < 7.5 && whole[1].until >= 6, `${whole[1].until}`);
  check('no two lines show at once', whole.every((l, i) => i === 0 || whole[i - 1].until <= l.at + 1e-9));
  check('between the two stretches nothing shows', lineAt(whole, 8.5) === null && lineAt(whole, 2.5)?.index === 0);

  // A snippet from the middle opens on the line the song has reached, timed from the snippet's own start.
  const late = timeLines(lines, voice, 16, 9, 6);
  check('a snippet from later in the song opens on a later line', late[0].index === 2 && near(late[0].at, 1), JSON.stringify(late));
  check('and times are counted from the start of the snippet, inside it', late.every((l) => l.at >= 0 && l.until <= 6 + 1e-9 && l.at < l.until));
  const mid = timeLines(lines, voice, 16, 3, 5);
  check('a line already under way when the snippet starts is up from the first frame', mid[0].at === 0 && mid[0].index <= 1, JSON.stringify(mid));

  // Putting it right by hand.
  const opened = timeLines(lines, voice, 16, 9, 6, { first: 0 });
  check('another line can be chosen to open on', opened[0].index === 0 && near(opened[0].at, 1));
  const nudged = timeLines(lines, voice, 16, 0, 16, { shift: { '1': 0.5, '2': -0.25 } });
  check('a line can be moved later or earlier by itself', near(nudged[1].at - whole[1].at, 0.5, 0.001) && near(nudged[2].at - whole[2].at, -0.25, 0.001) && nudged[0].at === whole[0].at && nudged[3].at === whole[3].at);
  const far = timeLines(lines, voice, 16, 0, 16, { shift: { '0': -99, '3': 99 } });
  check('a line cannot be moved out of the snippet or past its neighbours', far[0].at === 0 && far[3].at <= 16 - 0.3 + 1e-9 && far.every((l, i) => i === 0 || l.at > far[i - 1].at));

  // No voice to go by: an instrumental's lines are spread evenly.
  const even = timeLines(lines, [], 16, 0, 16);
  check('with no voice the lines are spread evenly', even.length === 4 && near(even[1].at - even[0].at, 4, 0.8) && near(even[3].at - even[2].at, 4, 0.8), JSON.stringify(even.map((l) => l.at)));
  // More lyrics than singing: lines keep a readable length, and the ones there is no time for are left out.
  const many = timeLines(Array.from({ length: 30 }, (_, i) => `Line number ${i + 1} of the song`), [{ from: 0, to: 6 }], 6, 0, 6);
  check('a short take with long lyrics shows a few readable lines, not thirty flashes', many.length >= 2 && many.length <= 6 && many.every((l) => l.until - l.at >= 0.9 || l === many[many.length - 1]), `${many.length}`);
  check('no lyrics, no lines', timeLines([], voice, 16, 0, 16).length === 0);

  // The words keep to the safe area of every shape, however many rows a line wraps to.
  for (const shape of ['tall', 'square', 'wide'] as const) {
    const box = wordsBox(shape, wordsBox(shape, 0, 44, true).maxRows, 44, true);
    check(`in the ${shape} shape the words stay above the foot of the frame and below the waveform`, box.bottom <= box.safeBottom && box.top >= box.wave, `${box.top}–${box.bottom}, wave ends ${box.wave}, safe to ${box.safeBottom}`);
  }
  check('the tall shape keeps the words clear of the bottom 210 pixels', wordsBox('tall', 3, 44, false).bottom === 1280 - 210);
}

async function main() {
  lyricTests();
  await undoTests();
  await artistTests();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
}
void main();
