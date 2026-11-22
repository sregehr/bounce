// End-to-end checks for the fixes that came out of the design review, in headless Chrome with a
// fake microphone: the microphone dropping or muting mid-take, the sample rate an import is
// decoded at, and refusing an over-long file before it is read.
// Usage: node test/e2e-review.mjs [flow]   (BASE, SHOTS, CHROME and VIEW as for e2e.mjs)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://localhost:8081';
const SHOTS = process.env.SHOTS ?? path.resolve('.e2e');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const flow = process.argv[2] ?? 'all';
fs.mkdirSync(SHOTS, { recursive: true });
const FILES = path.join(SHOTS, 'review-files');
fs.mkdirSync(FILES, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--user-data-dir=${path.join(SHOTS, 'profile-review-' + Date.now())}`],
});
const page = await browser.newPage();
const [viewWidth, viewHeight] = (process.env.VIEW ?? '390x844').split('x').map(Number);
// PHONE=1 makes the page a touch device, which is what the app takes for a phone when it decides how much audio to keep ready.
const PHONE = !!process.env.PHONE;
await page.setViewport({ width: viewWidth, height: viewHeight, deviceScaleFactor: 2, isMobile: PHONE, hasTouch: PHONE });

// Before the app loads: keep hold of the microphone tracks so a test can pull one out, count how
// much of each picked file is read, and let a test pin the live audio clock to a low rate, the
// way a Bluetooth headset microphone does.
await page.evaluateOnNewDocument(() => {
  window.__tracks = [];
  const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    const s = await open(c);
    window.__tracks.push(...s.getAudioTracks());
    return s;
  };
  window.__bytesRead = 0;
  const whole = Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer = function () {
    if (this instanceof File || this.size > 4e6) window.__bytesRead += this.size;
    return whole.call(this);
  };
  for (const way of ['readAsDataURL', 'readAsArrayBuffer', 'readAsBinaryString', 'readAsText']) {
    const read = FileReader.prototype[way];
    FileReader.prototype[way] = function (blob, ...rest) {
      if (blob instanceof File || blob.size > 4e6) window.__bytesRead += blob.size;
      return read.call(this, blob, ...rest);
    };
  }
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(options) {
      const rate = Number(sessionStorage.getItem('liveRate'));
      super(rate ? { ...options, sampleRate: rate } : options);
    }
  };
});

const problems = [];
page.on('console', (m) => m.type() === 'error' && !/TensorFlow Lite|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => problems.push(`error: ${String(e).slice(0, 300)}`));

let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (ok, name, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};
const text = () => page.evaluate(() => document.body.innerText);
async function waitFor(needle, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const t = await text();
    if (typeof needle === 'string' ? t.toLowerCase().includes(needle.toLowerCase()) : needle.test(t)) return true;
    await sleep(150);
  }
  return false;
}
async function expectText(needle, name, ms) {
  const ok = await waitFor(needle, ms);
  log(ok, name ?? `shows "${needle}"`, ok ? '' : `not found. Screen says: ${(await text()).replace(/\s+/g, ' ').slice(0, 400)}`);
  if (!ok) throw new Error(`stopped at: ${name ?? needle}`);
}
async function tap(label, { optional = false } = {}) {
  const hit = await page.evaluate((label) => {
    const nodes = [...document.querySelectorAll('[role=button],[role=link],[role=tab],[role=radio],[role=checkbox],[role=switch],a,button')];
    const found = nodes
      .filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
      })
      .filter((n) => [n.getAttribute('aria-label'), n.innerText?.trim()].filter(Boolean).some((v) => v === label))
      .pop();
    if (!found) return false;
    found.scrollIntoView({ block: 'center' });
    found.click();
    return true;
  }, label);
  if (!hit && !optional) log(false, `tap "${label}"`, `no such control. Screen says: ${(await text()).replace(/\s+/g, ' ').slice(0, 300)}`);
  await sleep(250);
  return hit;
}
async function type(label, value) {
  const handle = await page.evaluateHandle((label) => [...document.querySelectorAll('input,textarea')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop(), label);
  const el = handle.asElement();
  if (!el) return log(false, `type into "${label}"`, 'no such field');
  await el.click();
  await el.evaluate((n) => n.select());
  await el.type(value);
}
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const has = (label) => page.evaluate((label) => [...document.querySelectorAll('[role=button]')].some((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label), label);
/** The saved library, read straight from the browser's storage. */
const library = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('bounce', 1);
        open.onsuccess = () => {
          const all = open.result.transaction('kv', 'readonly').objectStore('kv').getAll();
          all.onsuccess = () => (open.result.close(), resolve(all.result.find((v) => v && v.projects)));
        };
      }),
  );
/** Clicks a control that opens a file picker and answers it with a file. */
async function choose(label, file) {
  // On a Home that already has beats, the ways to add one are behind this button.
  await tap('New beat', { optional: true });
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), tap(label)]);
  await chooser.accept([file]);
}

/** The shortest way through first launch, ending on the mic screen with the built-in demo beat. */
async function start() {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120000 });
  await expectText('Capture a beat. Freestyle over it.', 'onboarding opens on first launch', 60000);
  await tap('Try a demo beat');
  await expectText('Ready-made beats');
  await tap('Built in', { optional: true });
  await tap('Add Night bus');
  await expectText('Nothing recorded over this beat yet', 'a demo beat opens on its Song page', 20000);
  await tap('Connect a microphone', { optional: true });
}

async function counted() {
  await sleep(500);
  for (let i = 0; i < 60 && /Count-in · \d/.test(await text()); i++) await sleep(250);
}

// ---------- The microphone going away mid-take ----------

async function mic() {
  await tap('Freestyle over Night bus');
  await expectText('On the mic', 'the mic screen opens');
  await expectText('Tap to record', 'the microphone connects', 8000);

  // Muted on the device, or taken by a call: the track stays, but sends silence.
  await tap('Start recording');
  await counted();
  await sleep(3000);
  await page.evaluate(() => {
    const track = window.__tracks.at(-1);
    Object.defineProperty(track, 'muted', { configurable: true, get: () => true });
    track.dispatchEvent(new Event('mute'));
  });
  await expectText('The microphone was muted, so recording stopped. Take 1 saved', 'a mute mid-take stops the take, says why and keeps what was recorded', 8000);
  log(await has('Start recording'), 'and the record button is a record button again');
  await expectText('The microphone is muted, so a take would be silent', 'the mic screen says the microphone is muted');
  await tap('Start recording');
  await expectText('The microphone is muted. Unmute it', 'a take does not start into a muted microphone');
  log(!(await has('Stop recording')), 'so nothing is recording');
  await page.evaluate(() => {
    const track = window.__tracks.at(-1);
    delete track.muted;
    track.dispatchEvent(new Event('unmute'));
  });
  await sleep(400);
  log(!/would be silent/.test(await text()), 'the warning clears when the microphone is unmuted');

  // Unplugged or switched off: the track ends.
  await tap('Start recording');
  await counted();
  await sleep(3000);
  log(await has('Stop recording'), 'recording again, the button is a stop button');
  await page.evaluate(() => window.__tracks.at(-1).dispatchEvent(new Event('ended')));
  await expectText('The microphone was disconnected, so recording stopped. Take 2 saved', 'a disconnect mid-take stops the take, says why and keeps what was recorded', 8000);
  await shot('review-mic-dropped');
  await expectText('The input was disconnected.', 'the mic screen shows the microphone has gone');
  log(!(await has('Stop recording')), 'the beat is not left playing against a dead microphone');
  // The library is written a moment after a change, so the second take is waited for.
  let lib = await library();
  for (let i = 0; i < 10 && lib.projects[0].takes.length < 2; i++) (await sleep(200), (lib = await library()));
  const takes = lib.projects[0].takes;
  log(takes.length === 2 && takes.every((t) => t.durationSec > 1.5 && t.durationSec < 8), 'both takes hold what was sung before the microphone went', takes.map((t) => `take ${t.number}: ${t.durationSec.toFixed(1)} s`).join(', '));
  // With the microphone gone, the button offers to connect one again.
  await expectText('Connect a microphone', 'with no take running and no microphone, the screen offers to connect one');
  log(!(await has('Start recording')), 'in place of the record button');
}

// ---------- Importing files ----------

/** Makes a test file with ffmpeg, or returns null where there is none. */
function made(name, args) {
  const file = path.join(FILES, name);
  if (!fs.existsSync(file)) spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, file]);
  return fs.existsSync(file) ? file : null;
}
const beatNamed = async (name) => {
  // The library is written to storage a moment after it changes.
  for (let i = 0; i < 20; i++) {
    const found = (await library()).projects.find((p) => p.name === name)?.beat;
    if (found) return found;
    await sleep(250);
  }
  console.log('     saved beats: ' + (await library()).projects.map((p) => p.name).join(', '));
};

async function imports() {
  // The live audio clock at 16 kHz, as it is left after a Bluetooth headset has been the microphone.
  await page.evaluate(() => sessionStorage.setItem('liveRate', '16000'));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 120000 });
  await expectText('Night bus', 'Home opens', 20000);
  log((await page.evaluate(() => new AudioContext().sampleRate)) === 16000, 'the live audio clock is running at 16 kHz');

  const demo = path.join(FILES, 'Sky at forty four.m4a');
  fs.copyFileSync(path.resolve('public/demo/a-little-more-sky.m4a'), demo);
  await choose('Import a file', demo);
  await expectText('Nothing recorded over this beat yet', 'a 44.1 kHz M4A is imported', 30000);
  const sky = await beatNamed('Sky at forty four');
  log(sky?.sampleRate === 44100, 'and kept at 44.1 kHz, not the live clock\'s rate', `${sky?.sampleRate} Hz`);
  log(Math.abs((sky?.durationSec ?? 0) - 45) < 1.5, 'at its full length', `${sky?.durationSec?.toFixed(1)} s`);

  const mp3 = made('Tone at forty eight.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8:sample_rate=48000', '-ac', '2']);
  if (!mp3) console.log('skip the 48 kHz MP3: ffmpeg is not installed');
  else {
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 120000 });
    await choose('Import a file', mp3);
    await expectText('Nothing recorded over this beat yet', 'a 48 kHz MP3 is imported', 30000);
    const tone = await beatNamed('Tone at forty eight');
    log(tone?.sampleRate === 48000, 'and kept at 48 kHz', `${tone?.sampleRate} Hz`);
  }
  await page.evaluate(() => sessionStorage.removeItem('liveRate'));

  // Thirteen minutes of silence as a WAV: over the limit, and said so by its header.
  const long = path.join(FILES, 'Thirteen minutes.wav');
  const frames = 13 * 60 * 8000;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF', 0), wav.writeUInt32LE(36 + frames * 2, 4), wav.write('WAVEfmt ', 8), wav.writeUInt32LE(16, 16), wav.writeUInt16LE(1, 20), wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24), wav.writeUInt32LE(16000, 28), wav.writeUInt16LE(2, 32), wav.writeUInt16LE(16, 34), wav.write('data', 36), wav.writeUInt32LE(frames * 2, 40);
  fs.writeFileSync(long, wav);
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.evaluate(() => (window.__bytesRead = 0));
  await choose('Import a file', long);
  await expectText('That file is over 12 minutes long', 'a file over 12 minutes is refused', 20000);
  const read = await page.evaluate(() => window.__bytesRead);
  log(read === 0, 'without the whole file being read first', `${read} of ${wav.length} bytes read whole`);
  log(!(await library()).projects.some((p) => p.name === 'Thirteen minutes'), 'and nothing is added');
}

// ---------- Memory during a long export ----------

/** In-app navigation, so nothing held in memory is dropped the way a page load would drop it. */
async function go(route) {
  await page.evaluate((route) => {
    history.pushState({}, '', route);
    dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await sleep(600);
}

/**
 * Measures how much memory the tab uses while a long song is exported with every extra.
 * MINUTES sets the song's length (default 4). Not part of `all`: it records for that long.
 * Prints the peak resident memory of the page's process, sampled from outside the page so
 * that it is seen even while the page is busy, and the peak of the JavaScript heap plus buffers.
 */
async function memory() {
  const minutes = Number(process.env.MINUTES ?? 4);
  const rate = 44100;
  const frames = Math.round(minutes * 60 * rate);
  const file = path.join(FILES, `Long song ${minutes}.wav`);
  // A click on every beat at 90 BPM over a low drone: loud all the way through, so nothing is trimmed.
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF', 0), wav.writeUInt32LE(36 + frames * 4, 4), wav.write('WAVEfmt ', 8), wav.writeUInt32LE(16, 16), wav.writeUInt16LE(1, 20), wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24), wav.writeUInt32LE(rate * 4, 28), wav.writeUInt16LE(4, 32), wav.writeUInt16LE(16, 34), wav.write('data', 36), wav.writeUInt32LE(frames * 4, 40);
  const beat = Math.round((rate * 60) / 90);
  for (let i = 0; i < frames; i++) {
    const hit = Math.exp(-(i % beat) / 900) * Math.sin(i * 0.02) * 0.6;
    const v = Math.round((hit + Math.sin(i * 0.0157) * 0.2) * 32767);
    wav.writeInt16LE(v, 44 + i * 4);
    wav.writeInt16LE(Math.round(v * 0.9), 46 + i * 4);
  }
  fs.writeFileSync(file, wav);

  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 120000 });
  console.log(`     the page is a ${(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) ? 'touch device (phone budget)' : 'computer'}`);
  await choose('Import a file', file);
  await expectText('Nothing recorded over this beat yet', `a ${minutes}-minute beat is imported`, 180000);
  await tap(`Freestyle over Long song ${minutes}`);
  await expectText('Whole beat · once through', 'the mic screen opens on the whole beat');
  await expectText('Tap to record', 'the microphone connects', 8000);
  // A loop shorter than the beat is a window on the whole waveform, and moves four bars at a time.
  await tap('8 bars');
  await expectText(/Loop · bars 1–8 of \d+/i, 'a loop says where it sits in the beat');
  await expectText('Drag to move');
  const slider = '[role=slider][aria-label="Where the loop sits in the beat"]';
  await page.focus(slider);
  await page.keyboard.press('ArrowRight');
  await expectText(/Loop · bars 5–12 of/i, 'moving the window moves the loop four bars on');
  const box = await (await page.$(slider)).boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.02, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expectText(/Loop · bars 1–8 of/i, 'and dragging it to the start puts the loop back on bar 1');
  await shot('loop-window');
  await tap('Whole beat');
  await expectText('Whole beat · once through');
  await tap('Start recording');
  // The beat plays through once, and the take is saved when it ends. It stays on the mic screen, one tap from the mix.
  await expectText('Take 1 saved', 'a take the length of the beat is recorded', (minutes * 60 + 90) * 1000);
  await tap('Mix it');
  await expectText(/Polished\s/, 'and polished', 300000);
  await go('/export');
  await expectText('What is it for?', 'Share opens');
  // What plays on this screen is rendered at the export loudness; let it finish, as someone choosing options would.
  for (let i = 0; i < 600 && !(await has('Play')); i++) await sleep(500);
  await sleep(2000);
  await tap('Send to an engineer');
  await sleep(500);

  const downloadsTo = path.join(SHOTS, 'review-downloads-' + Date.now());
  fs.mkdirSync(downloadsTo, { recursive: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsTo });
  const whole = await browser.target().createCDPSession();
  const renderers = async () => (await whole.send('SystemInfo.getProcessInfo')).processInfo.filter((p) => p.type === 'renderer').map((p) => p.id);
  const pids = await renderers();
  const rss = () => Math.max(0, ...spawnSync('ps', ['-o', 'rss=', '-p', pids.join(',')]).stdout.toString().split('\n').map(Number).filter(Boolean)) / 1024;
  const heap = async () => {
    const h = await cdp.send('Runtime.getHeapUsage');
    return (h.usedSize + (h.backingStorageSize ?? 0)) / 1048576;
  };
  // What is really held, as opposed to waiting to be cleared away: measured after a forced collection.
  const held = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await sleep(500);
    await cdp.send('HeapProfiler.collectGarbage');
    return heap();
  };
  const heldBefore = await held();
  const before = { rss: rss(), heap: await heap() };
  let peakRss = before.rss, peakHeap = before.heap, peakHeld = heldBefore, sampling = true;
  const outside = (async () => {
    while (sampling) (peakRss = Math.max(peakRss, rss())), await sleep(50);
  })();
  const inside = (async () => {
    while (sampling) {
      peakHeap = Math.max(peakHeap, await heap().catch(() => 0));
      // With GC=1 a collection is forced before every other reading, which shows what the export
      // needs rather than what it leaves lying about. It slows the export, so it is its own run.
      if (process.env.GC) peakHeld = Math.max(peakHeld, await cdp.send('HeapProfiler.collectGarbage').then(heap).catch(() => 0));
      await sleep(100);
    }
  })();
  const started = Date.now();
  if (!(await tap('Save to Files', { optional: true }))) await tap('Save 3 files');
  await expectText('3 files saved to your downloads', 'the export finishes', 600000);
  const took = (Date.now() - started) / 1000;
  await sleep(1500);
  sampling = false;
  await Promise.all([outside, inside]);
  const heldAfter = await held();
  const saved = fs.readdirSync(downloadsTo).filter((f) => f.endsWith('.zip')).map((f) => fs.statSync(path.join(downloadsTo, f)).size)[0];
  log(saved > frames * 2 * 3 * 3 * 0.99, 'the ZIP holds three full-length 24-bit files', `${(saved / 1048576).toFixed(0)} MB`);
  const mb = (n) => `${Math.round(n)} MB`;
  console.log(`\nMEMORY ${minutes}-minute song, exported with the instrumental and the vocals (${took.toFixed(0)} s):`);
  console.log(`  page process, resident:   ${mb(before.rss)} before, ${mb(peakRss)} at its peak`);
  console.log(`  JavaScript heap + buffers: ${mb(before.heap)} before, ${mb(peakHeap)} at its peak (sampled between tasks)`);
  console.log(`  of that, really held (after a forced collection): ${mb(heldBefore)} before the export, ${process.env.GC ? `${mb(peakHeld)} at its peak, ` : ''}${mb(heldAfter)} after it`);
}

const flows = { mic, imports };
const extra = { memory };
const order = flow === 'all' ? Object.keys(flows) : flow.split(',');
Object.assign(flows, extra);
try {
  console.log('\n== start');
  await start();
  for (const name of order) {
    console.log(`\n== ${name}`);
    await flows[name]();
  }
} catch (e) {
  log(false, 'run', String(e).slice(0, 400));
  await shot('review-crash');
}
if (problems.length) {
  failed++;
  console.log(`\nBrowser problems (${problems.length}):\n` + [...new Set(problems)].slice(0, 12).join('\n'));
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
await browser.close();
process.exit(failed ? 1 : 0);
