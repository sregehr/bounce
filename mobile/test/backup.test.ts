// The backup when the server is full, refuses a file, or cannot be reached, and the deletion
// that is owed to it after "Delete everything on this device".
// The server here is a stand-in that answers the way `convex/backup.ts` does; `test/server.test.ts`
// checks the real one. Storage is the in-memory stand-in (`src/data/db.ts`).
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ConvexHttpClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';

import type { Beat } from '../src/data/model';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function read<T>(hook: () => T): T {
  let value!: T;
  renderToString(createElement(() => ((value = hook()), null)));
  return value;
}

type Owner = { deviceId: string; secret: string };
const MB = 1024 * 1024;
// The stand-in server: what it holds, what it allows, and how it has been told to misbehave.
const server = {
  down: false,
  files: new Map<string, number>(),
  projects: new Set<string>(),
  maxBytes: 4096 * MB,
  maxFile: 300 * MB,
  maxFiles: 2000,
  /** Answers `saveFile` with this whatever the size, as when the limits change between asking and sending. */
  refuse: null as null | 'too_big' | 'full',
  /** How many more times `erase` says there is more to delete. */
  eraseBatches: 0,
  /** Devices whose deletion fails. */
  eraseFails: new Set<string>(),
  erased: [] as string[],
  uploads: 0,
  calls: [] as string[],
};
const bytesHeld = () => [...server.files.values()].reduce((a, b) => a + b, 0);

async function answer(ref: unknown, args: Record<string, unknown>): Promise<unknown> {
  const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
  server.calls.push(name);
  if (server.down) throw new Error('fetch failed');
  switch (name) {
    case 'backup:fileKeys':
      return [...server.files.keys()];
    case 'backup:room':
      return { bytes: bytesHeld(), files: server.files.size, maxBytes: server.maxBytes, maxFile: server.maxFile, maxFiles: server.maxFiles };
    case 'backup:uploadUrl':
      return 'http://backup.test/upload';
    case 'backup:saveFile': {
      const size = args.size as number;
      if (server.refuse) return server.refuse;
      if (size > server.maxFile) return 'too_big';
      if (bytesHeld() + size > server.maxBytes || server.files.size >= server.maxFiles) return 'full';
      server.files.set(args.key as string, size);
      return 'saved';
    }
    case 'backup:saveProject':
      server.projects.add(args.localId as string);
      return null;
    case 'backup:removeProject':
      server.projects.delete(args.localId as string);
      for (const key of args.fileKeys as string[]) server.files.delete(key);
      return null;
    case 'backup:erase':
      if (server.eraseFails.has(args.deviceId as string)) throw new Error('fetch failed');
      if (server.eraseBatches > 0) return server.eraseBatches-- < 0;
      server.erased.push(args.deviceId as string);
      return true;
    default:
      throw new Error(`The stand-in server has no ${name}.`);
  }
}
ConvexHttpClient.prototype.query = answer as typeof ConvexHttpClient.prototype.query;
ConvexHttpClient.prototype.mutation = answer as typeof ConvexHttpClient.prototype.mutation;
globalThis.fetch = (async () => {
  server.uploads++;
  if (server.down) throw new Error('fetch failed');
  return { ok: true, status: 200, json: async () => ({ storageId: `stored-${server.uploads}` }) };
}) as unknown as typeof fetch;

const beat = (key: string): Beat => ({ key, durationSec: 30, sampleRate: 44100, channels: 2, source: 'demo', sourceLabel: '', peakDb: -1, lufs: -12, clipped: false, trimmedSec: 0, wave: [], leadSec: 0, bpm: 90, musicalKey: null });

const run = async () => {
  // The app reads the server address when it starts, so it is set before the app code is loaded.
  process.env.EXPO_PUBLIC_CONVEX_URL = 'http://backup.test';
  const { kv, blobs } = await import('../src/data/db');
  const { createProject, deleteProject, flushLibrary, getLibrary, loadLibrary, setSettings } = await import('../src/data/store');
  const { backupNow, eraseBackup, useBackup } = await import('../src/data/backup');

  await loadLibrary();
  const state = () => read(useBackup);
  /** Starts a backup and waits until it has finished and the server has gone quiet. */
  const backUp = async () => {
    await flushLibrary();
    backupNow();
    for (let quiet = 0, seen = -1; quiet < 3; ) {
      await sleep(15);
      if (server.calls.length === seen && state().status !== 'working') quiet++;
      else quiet = 0;
      seen = server.calls.length;
    }
    return state();
  };
  /** Adds a beat whose audio is `size` bytes. */
  const add = async (name: string, size: number) => {
    await blobs.put(`beat-${name}`, new Blob([new Uint8Array(size)], { type: 'audio/wav' }));
    return createProject(beat(`beat-${name}`), name);
  };

  // Room for everything.
  const first = await add('first', 1000);
  let s = await backUp();
  check('with room, everything is backed up', s.status === 'done' && s.skipped === 0 && server.files.has('beat-first') && server.projects.has(first.id), JSON.stringify(s));
  check('and the time of the backup is noted', typeof s.lastAt === 'number');
  server.calls.length = 0;
  s = await backUp();
  check('a second run with nothing new sends nothing', s.status === 'done' && !server.calls.includes('backup:uploadUrl') && !server.calls.includes('backup:saveProject'), server.calls.join(', '));

  // One file is bigger than the server takes: it is left out and counted, and the rest still goes.
  server.maxFile = 5000;
  const uploadsBefore = server.uploads;
  const big = await add('big', 6000);
  await add('small', 2000);
  s = await backUp();
  check('a file bigger than the server takes is never sent', !server.files.has('beat-big') && server.uploads === uploadsBefore + 1, `${server.uploads - uploadsBefore} uploads`);
  check('it is counted as skipped, and the backup still finishes', s.status === 'done' && s.skipped === 1, JSON.stringify(s));
  check('the files that fit are backed up alongside it', server.files.has('beat-small') && server.projects.has(big.id));
  s = await backUp();
  check('the skipped file is still reported on the next run', s.status === 'done' && s.skipped === 1, JSON.stringify(s));
  await deleteProject(big.id);
  s = await backUp();
  check('deleting the song that was too big clears the message', s.status === 'done' && s.skipped === 0 && !server.projects.has(big.id), JSON.stringify(s));

  // The backup has no room left: nothing more is sent, and the state says so.
  server.maxFile = 300 * MB;
  server.maxBytes = bytesHeld() + 1500;
  const before = server.uploads;
  // Files go up newest song first, so the small one is added first to come after the one with no room.
  await add('would-fit', 100);
  const noRoom = await add('no-room', 2000);
  s = await backUp();
  check('a file the backup has no room for is not sent', !server.files.has('beat-no-room'), [...server.files.keys()].join(', '));
  check('nor is anything after it, so the backup does not fill up out of order', !server.files.has('beat-would-fit') && server.uploads === before);
  check('the backup says it is full', s.status === 'full', JSON.stringify(s));
  check('the songs themselves are still recorded', server.projects.has(noRoom.id));
  server.maxBytes = 4096 * MB;
  s = await backUp();
  check('once there is room the rest goes up', s.status === 'done' && server.files.has('beat-no-room') && server.files.has('beat-would-fit'), JSON.stringify(s));

  // The server has the last word: its answer to a file it was sent decides, whatever it said about room.
  server.refuse = 'too_big';
  const refused = await add('refused', 100);
  s = await backUp();
  check('a file the server answers "too_big" to is counted as skipped', s.status === 'done' && s.skipped === 1 && !server.files.has('beat-refused'), JSON.stringify(s));
  server.refuse = 'full';
  s = await backUp();
  check('a file the server answers "full" to marks the backup full', s.status === 'full' && !server.files.has('beat-refused'), JSON.stringify(s));
  server.refuse = null;
  s = await backUp();
  check('and is sent once the server takes it', s.status === 'done' && s.skipped === 0 && server.files.has('beat-refused') && server.projects.has(refused.id), JSON.stringify(s));

  // The server cannot be reached.
  server.down = true;
  await add('offline', 100);
  s = await backUp();
  check('with no server the backup says it cannot reach it', s.status === 'unreachable', JSON.stringify(s));

  // "Delete everything" while the server is away: the deletion is kept for later.
  const mine: Owner = { deviceId: getLibrary().settings.deviceId, secret: getLibrary().settings.deviceSecret };
  const other: Owner = { deviceId: 'an-earlier-device-id', secret: 's'.repeat(64) };
  check('erasing with no server reports that the copy is still there', (await eraseBackup(mine)) === false);
  check('and keeps the request', JSON.stringify(await kv.get('erase')) === JSON.stringify([mine]), JSON.stringify(await kv.get('erase')));
  await eraseBackup(other);
  check('a second request is kept alongside the first', JSON.stringify(await kv.get('erase')) === JSON.stringify([mine, other]));
  await backUp();
  check('while the server is still away the requests stay', (await kv.get<Owner[]>('erase'))?.length === 2 && server.erased.length === 0);

  // Back online, with one of the two deletions still failing.
  server.down = false;
  server.eraseFails.add(other.deviceId);
  await backUp();
  check('the next backup run sends the deletions that are owed', server.erased.includes(mine.deviceId), server.erased.join(', '));
  check('and keeps only the one that failed', JSON.stringify(await kv.get('erase')) === JSON.stringify([other]), JSON.stringify(await kv.get('erase')));

  // A deletion that is owed goes out even when backup has been switched off since.
  server.eraseFails.clear();
  setSettings({ backup: false });
  s = await backUp();
  check('an owed deletion is sent even with backup switched off', server.erased.includes(other.deviceId) && s.status === 'off', JSON.stringify(s));
  check('and then nothing is owed', JSON.stringify(await kv.get('erase')) === '[]', JSON.stringify(await kv.get('erase')));

  // With the server there, erasing happens straight away, a batch at a time.
  server.erased.length = 0;
  server.calls.length = 0;
  server.eraseBatches = 2;
  check('erasing with the server there reports the copy gone', (await eraseBackup(mine)) === true);
  check('after asking until the server says nothing is left', server.calls.filter((c) => c === 'backup:erase').length === 3 && server.erased.length === 1, server.calls.join(', '));
  check('and nothing is kept for later', JSON.stringify(await kv.get('erase')) === '[]');

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
};
run();
