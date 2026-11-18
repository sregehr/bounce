// The library store when storage misbehaves, and takes recorded as layers.
// Runs against the in-memory stand-in for storage (`src/data/db.ts`), with its reads and writes swapped out to fail on demand.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { kv } from '../src/data/db';
import { LAYER_START, emptyLibrary, type Beat, type Library, type Take } from '../src/data/model';
import { addTake, createProject, deleteTake, flushLibrary, getLibrary, getProject, loadLibrary, setProfile, useLoadError, useReady } from '../src/data/store';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** What a hook returns, read the way a screen would read it. */
function read<T>(hook: () => T): T {
  let value!: T;
  renderToString(createElement(() => ((value = hook()), null)));
  return value;
}

const beat: Beat = { key: 'beat-1', durationSec: 30, sampleRate: 44100, channels: 2, source: 'demo', sourceLabel: '', peakDb: -1, lufs: -12, clipped: false, trimmedSec: 0, wave: [], leadSec: 0, bpm: 90, musicalKey: null };
const take = (n: number): Take => ({ key: `take-${n}`, durationSec: 5, sampleRate: 44100, channels: 1, id: `t${n}`, number: n, createdAt: n, phaseSec: 0, loop: { bars: 0, startBar: 0 }, wave: [], peakDb: -6, clipped: false, origin: 'recorded', voice: null });

const run = async () => {
  // A library saved earlier, with one song in it.
  const saved: Library = { ...emptyLibrary(), vault: 1, profile: { artist: 'Kai', producer: '', onboarded: true } };
  await kv.set('library', saved);
  const before = JSON.stringify(saved);

  const realGet = kv.get;
  const realSet = kv.set;
  const writes: string[] = [];
  kv.set = async (key, value) => (writes.push(key), realSet(key, value));

  // Storage refuses to be read.
  kv.get = async () => {
    throw new Error('Storage is busy in another tab.');
  };
  await loadLibrary();
  check('a library that cannot be read is reported', read(useLoadError) === 'Storage is busy in another tab.', String(read(useLoadError)));
  check('and the app does not count as ready', read(useReady) === false);

  // Whatever happens on screen meanwhile, nothing reaches storage.
  setProfile({ artist: 'Somebody else' });
  await sleep(400);
  await flushLibrary();
  check('nothing is written while it cannot be read', writes.length === 0, writes.join(', '));
  check('so the saved library is untouched', JSON.stringify(await realGet('library')) === before);

  // A second failure keeps the message; a failure with no message gets a plain one.
  kv.get = async () => {
    throw new Error('');
  };
  await loadLibrary();
  check('a failure with no message still says something', read(useLoadError) === 'Storage is not available.', String(read(useLoadError)));

  // Trying again once storage answers brings the saved library back.
  kv.get = realGet;
  await loadLibrary();
  check('trying again clears the error', read(useLoadError) === null && read(useReady) === true);
  check('and opens the library that was saved, not the one from the failed start', getLibrary().profile.artist === 'Kai', getLibrary().profile.artist);

  // From here on changes are saved again.
  setProfile({ artist: 'Kai Rivers' });
  await sleep(400);
  check('changes are written again afterwards', writes.includes('library') && (await realGet<Library>('library'))?.profile.artist === 'Kai Rivers');

  // A take recorded as a layer joins the picked take instead of replacing it.
  const project = createProject(beat, 'Night bus');
  addTake(project.id, take(1));
  check('a take becomes the picked one', getProject(project.id)?.takeId === 't1');
  addTake(project.id, take(2), 'adlib');
  const layered = getProject(project.id)!;
  check('a take recorded as a layer leaves the picked take picked', layered.takeId === 't1' && layered.takes.length === 2);
  check('and is stacked on it as an ad-lib, at the ad-lib level and pan', JSON.stringify(layered.layers) === JSON.stringify([{ takeId: 't2', role: 'adlib', ...LAYER_START.adlib }]), JSON.stringify(layered.layers));
  await deleteTake(project.id, 't2');
  check('deleting that take removes its layer', getProject(project.id)?.layers?.length === 0 && getProject(project.id)?.takeId === 't1');

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
};
run();
