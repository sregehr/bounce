// The backup limits on the real server: what `saveFile` in `convex/backup.ts` answers when a file
// is too big or the backup is full, and what `room` reports.
//
// Needs the local server from `npx convex dev` running, and Node 22.13 or newer for the Convex
// command line. It sets BACKUP_MAX_MB and BACKUP_MAX_FILE_MB to a few kilobytes while it runs and
// removes them again afterwards, so it refuses to run against anything but a server on this computer.
// Usage: npm run test:server
/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';

import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
}

const env = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '';
const url = process.env.EXPO_PUBLIC_CONVEX_URL ?? /^EXPO_PUBLIC_CONVEX_URL=(.+)$/m.exec(env)?.[1]?.trim();
if (!url || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
  console.log(`This test changes server settings, so it only runs against a local server. Found: ${url ?? 'no EXPO_PUBLIC_CONVEX_URL in .env.local'}`);
  process.exit(1);
}

/** Sets a server setting, or removes it when no value is given. */
function setting(name: string, value?: string) {
  const done = spawnSync('npx', value === undefined ? ['convex', 'env', 'remove', name] : ['convex', 'env', 'set', name, value], { encoding: 'utf8' });
  if (done.status !== 0 && value !== undefined) throw new Error(`Could not set ${name} on the server: ${(done.stderr || done.stdout).trim().slice(0, 300)}`);
}

/** What a server setting is now, or undefined when it is not set. */
function current(name: string) {
  const got = spawnSync('npx', ['convex', 'env', 'get', name], { encoding: 'utf8' });
  if (got.status !== 0) throw new Error(`Could not read ${name} from the server: ${(got.stderr || got.stdout).trim().slice(0, 300)}`);
  return /not found/.test(got.stdout + got.stderr) ? undefined : got.stdout.trim() || undefined;
}

const client = new ConvexHttpClient(url);
const owner = { deviceId: `test-${randomBytes(12).toString('hex')}`, secret: randomBytes(32).toString('hex') };
const KB = 1024;

/** Uploads `size` bytes and asks the server to record them under `key`. */
async function send(key: string, size: number) {
  const target = await client.mutation(api.backup.uploadUrl, owner);
  const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(size) });
  if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
  // The size the app claims is deliberately wrong: the server measures the file itself.
  return await client.mutation(api.backup.saveFile, { ...owner, key, storageId, size: 1 });
}

const run = async () => {
  const before = { file: current('BACKUP_MAX_FILE_MB'), total: current('BACKUP_MAX_MB') };
  try {
    // One file may be 2 KB, the whole backup 5 KB.
    setting('BACKUP_MAX_FILE_MB', String((2 * KB) / (KB * KB)));
    setting('BACKUP_MAX_MB', String((5 * KB) / (KB * KB)));

    let room = await client.query(api.backup.room, owner);
    check('the server reports the limits it was given', room.maxFile === 2 * KB && room.maxBytes === 5 * KB, JSON.stringify(room));
    check('a device that has sent nothing uses nothing', room.bytes === 0 && room.files === 0);

    check('a file that fits is saved', (await send('one', 1500)) === 'saved');
    check('a file over the size limit is answered "too_big"', (await send('huge', 3000)) === 'too_big');
    room = await client.query(api.backup.room, owner);
    check('and does not count against the backup', room.bytes === 1500 && room.files === 1, JSON.stringify(room));

    check('a second file that fits is saved', (await send('two', 2000)) === 'saved');
    check('the same file sent again is answered "saved" without being kept twice', (await send('two', 2000)) === 'saved');
    room = await client.query(api.backup.room, owner);
    check('the server counts what it holds by the real size of each file', room.bytes === 3500 && room.files === 2, JSON.stringify(room));

    check('a file the backup has no room for is answered "full"', (await send('three', 1700)) === 'full');
    check('a smaller one that still fits is saved', (await send('four', 1500)) === 'saved');
    const keys = (await client.query(api.backup.fileKeys, owner)).sort();
    check('only the saved files are in the backup', keys.join(',') === 'four,one,two', keys.join(','));

    // With the limits removed the defaults are back.
    setting('BACKUP_MAX_FILE_MB');
    setting('BACKUP_MAX_MB');
    room = await client.query(api.backup.room, owner);
    check('removing the settings restores the defaults', room.maxFile === 300 * KB * KB && room.maxBytes === 4096 * KB * KB, JSON.stringify(room));
    check('and the file that was too big is taken', (await send('huge', 3000)) === 'saved');

    // Somebody else cannot erase this backup; its own device can.
    const stranger = await client.mutation(api.backup.erase, { ...owner, secret: randomBytes(32).toString('hex') }).then(
      () => 'erased',
      () => 'refused',
    );
    check('a wrong secret cannot erase the backup', stranger === 'refused');
    check('the device itself can', (await client.mutation(api.backup.erase, owner)) === true);
    room = await client.query(api.backup.room, owner);
    check('and then it holds nothing', room.bytes === 0 && room.files === 0 && (await client.query(api.backup.fileKeys, owner)).length === 0, JSON.stringify(room));
  } catch (e) {
    check('run', false, String(e).slice(0, 400));
  } finally {
    // Whatever happened, the limits go back to what they were and the test device does not stay behind.
    setting('BACKUP_MAX_FILE_MB', before.file);
    setting('BACKUP_MAX_MB', before.total);
    await client.mutation(api.backup.erase, owner).catch(() => {});
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
};
run();
