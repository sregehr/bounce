import { DEFAULT_MASTER, DEFAULT_POLISH } from '../src/dsp/presets';
import { emptyLibrary, type Library, type Project, type Take } from '../src/data/model';
import { routeKey, timingFor, withTiming } from '../src/data/timing';
import { beatsIn, carryOver, loadedSong, makeSong, micLead, mixLead, songLead, songsIn, workBeat } from '../src/data/songs';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
}

const audio = (key: string) => ({ key, durationSec: 30, sampleRate: 44100, channels: 2 });
const take = (n: number): Take => ({ ...audio(`take-${n}`), id: `t${n}`, number: n, createdAt: n, phaseSec: 0, loop: { bars: 8, startBar: 0 }, wave: [], peakDb: -6, clipped: false, origin: 'recorded', voice: null });
function beat(id: string, takes: Take[] = [], patch: Partial<Project> = {}): Project {
  return {
    id,
    name: `Beat ${id}`,
    createdAt: 1,
    updatedAt: 5,
    beat: { ...audio(`beat-${id}`), source: 'demo', sourceLabel: '', peakDb: -1, lufs: -12, clipped: false, trimmedSec: 0, wave: [], leadSec: 0, bpm: 90, musicalKey: null },
    loop: { bars: 8, startBar: 0 },
    takes,
    takeId: takes[takes.length - 1]?.id ?? null,
    polish: DEFAULT_POLISH,
    master: DEFAULT_MASTER,
    overrides: {},
    exporting: { loudness: 'streaming', format: 'wav24', instrumental: true, vocals: false },
    snippet: { lengthSec: 20, captions: true, credit: true, caption: '', made: false },
    cover: { scene: 'photo', photoKey: null, cutoutKey: null, imageKey: null },
    lyrics: '',
    stats: null,
    ...patch,
  };
}
const lib = (projects: Project[], patch: Partial<Library> = {}): Library => ({ ...emptyLibrary(), vault: 1, projects, ...patch });

// Finishing a song.
const a = beat('a', [take(1), take(2), take(3)], { takeId: 't2' });
const song = makeSong(a, '  Night bus  ', 100);
check('a finished song keeps only the chosen take', song.takes.length === 1 && song.takeId === 't2' && song.takes[0].key === 'take-2');
check('it gets its own id, the typed title and a link to its beat', song.id !== a.id && song.name === 'Night bus' && song.saved?.from === 'a' && song.saved.at === 100);
check('an empty title falls back to the beat name', makeSong(a, '  ', 1).name === 'Beat a');
check('the beat is left as it was', a.takes.length === 3 && !a.saved);
check('an instrumental can be finished', makeSong(beat('i'), 'Inst', 1).takes.length === 0);
const older = makeSong(a, 'Older', 50);
check('beats and songs are told apart', beatsIn([song, a, older]).length === 1 && songsIn([older, a, song]).map((p) => p.name).join() === 'Night bus,Older');

// Where the tabs lead.
check('with nothing, every tab stays on its own screen, which offers to add a beat', micLead(lib([])).to === '/vocals' && songLead(lib([])).to === '/song' && mixLead(lib([])).to === '/playback' && [micLead, mixLead, songLead].every((f) => f(lib([])).id === null && !f(lib([])).hint));
const bare = lib([beat('b')], { currentId: 'b' });
check('with a beat and no takes, the mic records and Song opens it', micLead(bare).to === '/vocals' && !micLead(bare).hint && songLead(bare).to === '/song' && songLead(bare).id === 'b');
check('…and Mix leads to recording, with its reason', mixLead(bare).to === '/vocals' && mixLead(bare).hint === 'mix');
const recorded = lib([beat('b'), a], { currentId: 'b' });
check('Mix opens a beat that has takes when the current one has none', mixLead(recorded).to === '/playback' && mixLead(recorded).id === 'a' && !mixLead(recorded).hint);
const full = lib([song, older, a], { currentId: song.id, songId: older.id });
check('the song played last is remembered', loadedSong(full)?.id === older.id);
check('…or the newest when none has been', loadedSong({ ...full, songId: null })?.id === song.id);
check('with a finished song open, Song, Mix and the mic go to the beat it came from', workBeat(full)?.id === 'a' && micLead(full).id === 'a' && songLead(full).id === 'a' && mixLead(full).id === 'a');
check('if that beat is gone, the mic has nothing to record over', micLead(lib([song], { currentId: song.id })).id === null);

// Carrying over a library from before the Vault held finished songs only.
const old: Library = { ...emptyLibrary(), projects: [beat('plain', [take(1)]), beat('lyric', [take(1)], { lyrics: 'bars' }), beat('cover', [take(1)], { cover: { scene: 'stage', photoKey: 'p', cutoutKey: null, imageKey: 'c' } }), beat('notake', [], { lyrics: 'bars' })] };
const moved = carryOver(old);
check('songs with lyrics or a cover are carried into the Vault', songsIn(moved.projects).map((p) => p.saved?.from).sort().join() === 'cover,lyric', songsIn(moved.projects).map((p) => p.saved?.from).join());
check('every beat stays where it was', beatsIn(moved.projects).length === 4);
check('carrying over happens once', carryOver(moved) === moved && moved.vault === 1);

// Timing follows the setup: each microphone and speaker pair keeps its own figure.
const phone = { input: 'iPhone Microphone', output: '' };
const speaker = { input: 'iPhone Microphone', output: 'JBL Flip 6' };
const fresh = { latencyMs: null as number | null };
check('an unmeasured setup uses what the browser reports', timingFor(fresh, phone, 42).ms === 42 && !timingFor(fresh, phone, 42).measured);
check('a wireless speaker is estimated long when the browser under-reports it', timingFor(fresh, speaker, 42).ms === 230);
check('a long reported delay is trusted as it is', timingFor(fresh, speaker, 190).ms === 190);
const onPhone = withTiming(fresh, phone, 42, 80);
const onBoth = { ...onPhone, ...withTiming(onPhone, speaker, 42, 228) };
check('each setup keeps its own measurement', timingFor(onBoth, phone, 42).ms === 80 && timingFor(onBoth, speaker, 42).ms === 228 && timingFor(onBoth, phone, 42).measured);
check('a hidden speaker still counts as another setup when the delay is long', routeKey(phone, 42) !== routeKey(phone, 200) && timingFor(onBoth, phone, 200).ms === 200);
check('a figure from before setups were told apart still applies', timingFor({ latencyMs: 95 }, phone, 42).ms === 95);
check('forgetting a measurement goes back to the estimate', timingFor({ ...onBoth, ...withTiming(onBoth, speaker, 42, null) }, speaker, 42).ms === 230);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
