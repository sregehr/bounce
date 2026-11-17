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
await page.setViewport({ width: viewWidth, height: viewHeight, deviceScaleFactor: 2 });

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
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), tap(label)]);
  await chooser.accept([file]);
}

/** The shortest way through first launch, ending on the Song tab with the built-in demo beat. */
async function start() {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120000 });
  await expectText('Capture a beat. Freestyle over it.', 'onboarding opens on first launch', 60000);
  await tap('Get started');
  await type('Artist name', 'Kai Rivers');
  await tap('Continue');
  if (await waitFor('Keep it yours', 3000)) await tap('Not now');
  await expectText('Sound check');
  await tap('Connect an input');
  await expectText('Connected', 'input connects');
  await tap('Continue');
  await expectText('Line up your takes');
  await tap('Continue');
  await expectText('Ready, Kai Rivers.');
  await tap('Try a demo song');
  await expectText('Ready-made beats');
  await tap('Built in', { optional: true });
  await tap('Add Night bus');
  await expectText('No takes yet', 'a demo beat opens on the Song tab', 20000);
}

async function counted() {
  await sleep(500);
  for (let i = 0; i < 60 && /Count-in · \d/.test(await text()); i++) await sleep(250);
}

// ---------- The microphone going away mid-take ----------

async function mic() {
  await tap('Freestyle over Night bus');
  await expectText('Always listening', 'the mic screen opens');
  await expectText(/Fake .* ms (estimated|measured)/, 'the microphone connects', 8000);

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
  const lib = await library();
  const takes = lib.projects[0].takes;
  log(takes.length === 2 && takes.every((t) => t.durationSec > 1.5 && t.durationSec < 8), 'both takes hold what was sung before the microphone went', takes.map((t) => t.durationSec.toFixed(1)).join(', '));
  // With the microphone gone, the button offers to connect one again.
  await tap('Start recording');
  await expectText('Connect a microphone', 'with no take running and no microphone, the button offers to connect one');
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
  await expectText('No takes yet', 'a 44.1 kHz M4A is imported', 30000);
  const sky = await beatNamed('Sky at forty four');
  log(sky?.sampleRate === 44100, 'and kept at 44.1 kHz, not the live clock\'s rate', `${sky?.sampleRate} Hz`);
  log(Math.abs((sky?.durationSec ?? 0) - 45) < 1.5, 'at its full length', `${sky?.durationSec?.toFixed(1)} s`);

  const mp3 = made('Tone at forty eight.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8:sample_rate=48000', '-ac', '2']);
  if (!mp3) console.log('skip the 48 kHz MP3: ffmpeg is not installed');
  else {
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 120000 });
    await choose('Import a file', mp3);
    await expectText('No takes yet', 'a 48 kHz MP3 is imported', 30000);
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

const flows = { mic, imports };
const order = flow === 'all' ? Object.keys(flows) : flow.split(',');
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
