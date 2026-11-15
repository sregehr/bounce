// End-to-end run of the web app in headless Chrome, with a fake microphone
// (Chrome's built-in test tone) standing in for real audio input.
// Usage: node test/e2e.mjs [flow]   Screenshots go to $SHOTS (default ./.e2e).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://localhost:8081';
const SHOTS = process.env.SHOTS ?? path.resolve('.e2e');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const flow = process.argv[2] ?? 'all';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--user-data-dir=${path.join(SHOTS, 'profile-' + Date.now())}`],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const problems = [];
const chatter = new Set();
page.on('console', (m) => {
  if (m.type() === 'warn' || m.type() === 'error') chatter.add(`${m.type()}: ${m.text().slice(0, 260)}`);
  // The segmentation library logs its start-up line as an error, and the browser's own
  // "failed to load" line carries no address; failed requests are listed with theirs below.
  if (m.type() === 'error' && !/TensorFlow Lite|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => problems.push(`error: ${String(e).slice(0, 300)}`));
page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/symbolicate') && problems.push(`http ${r.status()}: ${r.url().slice(0, 200)}`));

let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (ok, name, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};

/** Visible text of the screen on top. */
const text = () => page.evaluate(() => document.body.innerText);
async function waitFor(needle, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const t = await text();
    // Uppercase styling changes what innerText reports, so compare without case.
    if (typeof needle === 'string' ? t.toLowerCase().includes(needle.toLowerCase()) : needle.test(t)) return true;
    await sleep(150);
  }
  return false;
}
async function expectText(needle, name, ms) {
  const ok = await waitFor(needle, ms);
  log(ok, name ?? `shows "${needle}"`, ok ? '' : `not found. Screen says: ${(await text()).replace(/\s+/g, ' ').slice(0, 400)}`);
  // Later steps depend on earlier ones, so stop at the first thing that is not there.
  if (!ok) throw new Error(`stopped at: ${name ?? needle}`);
  return ok;
}
/** Clicks the last visible control whose label or text matches. */
async function tap(label, { exact = true, optional = false } = {}) {
  const hit = await page.evaluate(
    (label, exact) => {
      const nodes = [...document.querySelectorAll('[role=button],[role=link],[role=tab],[role=radio],[role=checkbox],[role=switch],a,button')];
      const visible = nodes.filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
      });
      const match = (n) => {
        const names = [n.getAttribute('aria-label'), n.innerText?.trim()].filter(Boolean);
        return names.some((v) => (exact ? v === label : v.includes(label)));
      };
      const found = visible.filter(match).pop();
      if (!found) return false;
      found.scrollIntoView({ block: 'center' });
      found.click();
      return true;
    },
    label,
    exact,
  );
  if (!hit && !optional) log(false, `tap "${label}"`, `no such control. Screen says: ${(await text()).replace(/\s+/g, ' ').slice(0, 300)}`);
  await sleep(250);
  return hit;
}
async function type(label, value) {
  const handle = await page.evaluateHandle((label) => [...document.querySelectorAll('input,textarea')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop(), label);
  const el = handle.asElement();
  if (!el) return log(false, `type into "${label}"`, 'no such field');
  await el.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await el.type(value, { delay: 5 });
}
const shot = async (name) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};
/** Drags a slider (found by its label) to a fraction of its width. */
async function slide(label, fraction) {
  const box = await page.evaluate((label) => {
    const n = [...document.querySelectorAll('[role=slider]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop();
    if (!n) return null;
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, label);
  if (!box) return log(false, `slide "${label}"`, 'no such slider');
  const y = box.y + box.h / 2;
  await page.mouse.move(box.x + box.w / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 9 + (box.w - 18) * fraction, y, { steps: 6 });
  await page.mouse.up();
  await sleep(200);
}
const state = (expr) => page.evaluate(expr);
const trackAt = (label) => page.evaluate((label) => Number([...document.querySelectorAll('[role=slider]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop()?.getAttribute('aria-valuenow') ?? NaN), label);
async function tapTrack(label, fraction) {
  const box = await page.evaluate((label) => {
    const n = [...document.querySelectorAll('[role=slider]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop();
    if (!n) return null;
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, label);
  if (!box) return log(false, `tap track "${label}"`, 'no such track');
  await page.mouse.click(box.x + box.w * fraction, box.y + box.h / 2);
  await sleep(250);
}

async function onboarding() {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120000 });
  await expectText('Capture a beat. Freestyle over it.', 'onboarding opens on first launch', 60000);
  await shot('01-welcome');
  await tap('Get started');
  await expectText('What do you go by?');
  await type('Artist name', 'Kai Rivers');
  await type('Producer name', 'Lowkey');
  await shot('02-names');
  await tap('Continue');
  await expectText('Sound check');
  await tap('Connect an input');
  await expectText('Connected', 'input connects');
  await sleep(1200);
  await shot('03-soundcheck');
  await tap('Continue');
  await expectText('Line up your takes');
  await tap('Play the clicks');
  await expectText(/Heard all the clicks|clicks came back/i, 'latency check finishes', 12000);
  await shot('04-timing');

  // The earbud route: clap along to the pulse while the mic listens. Nobody claps here, so it only has to finish cleanly.
  await tap('Wearing earbuds? Clap along instead');
  await expectText('Clap on every click', 'the clap-along check opens');
  await sleep(2500);
  await shot('04b-clap-along');
  await expectText(/Measured from \d of 8 claps|claps lined up/, 'the clap-along check finishes', 12000);
  await tap('Run it again');
  await expectText(/Heard all the clicks|clicks came back/i, 'the click check still runs afterwards', 12000);

  await sleep(300); // the check clears its busy state a moment after the result shows
  await tap('Continue');
  await expectText('Ready, Kai Rivers.');
  await shot('05-first-beat');
  await tap('Try a demo song');
  await expectText('Ready-made beats', 'the demo songs are listed');
  await shot('05b-demo-songs');
  await tap('Add Small Steps, Big City');
  await expectText('What next?', 'a demo song lands on the beat screen', 30000);
  await expectText('94 BPM', 'and keeps the tempo it was written at');
  await page.goto(BASE + '/demos', { waitUntil: 'networkidle2', timeout: 120000 });
  await expectText('Ready-made beats', 'the demo songs open again');
  await tap('Add Night bus');
  await expectText('What next?', 'demo beat lands on the beat screen', 20000);
  await expectText('92 BPM', 'tempo detected');
  await expectText('F minor', 'key detected');
  await shot('06-beat');
}

/** Reads the engine's playback clock by sampling the time shown in the compact transport. */
const transportPlaying = () => state(() => !![...document.querySelectorAll('[role=button]')].filter((n) => n.getBoundingClientRect().width > 0).find((n) => n.getAttribute('aria-label') === 'Pause'));

async function song() {
  await tap('Freestyle over it', { exact: false });
  await expectText('Always listening', 'vocals screen opens');
  await expectText('Mic: Fake', 'microphone connects by itself once allowed', 8000);
  await shot('07-vocals-idle');
  await tap('Start recording');
  await expectText(/Bar \d+ · pass 1/, 'recording shows the bar and pass', 5000);
  await sleep(2500);
  await shot('08-vocals-recording');
  await sleep(4000);
  await tap('Done, hear it back');
  await expectText('Take 1', 'playback opens on the new take', 10000);
  await expectText(/ready in [\d.]+ s/, 'polish finishes', 30000);
  log(await transportPlaying(), 'the polished take plays by itself');
  await shot('09-playback');
  await tap('Raw take');
  await sleep(300);
  await tap('Polished');
  await tap('Melodic');
  await expectText(/updating|working/i, 'changing the style re-renders', 4000);
  await expectText(/ready in [\d.]+ s/, 'second polish finishes', 30000);
  await tap('Tweak it', { exact: false });
  await expectText('Double track, nudged and panned');
  await slide('Vocal level', 0.9);
  await expectText(/ready in [\d.]+ s/, 'vocal level change renders', 30000);
  await shot('10-playback-tweak');

  // A second take, then punch in over it.
  await tap('Run it back');
  await expectText('Always listening');
  await tap('Punch in at bar 5', { exact: false });
  await tap('Start recording');
  await sleep(4500);
  await tap('Stop recording');
  await expectText('Take 2 saved', 'second take is saved in place', 10000);
  // Listening mode: hold what was played, then keep it.
  await tap('Play the loop');
  await expectText('Holding the last', 'listening holds the input', 5000);
  await sleep(3500);
  await tap('Keep that');
  await expectText('Take 3', 'kept take opens in playback', 10000);
  await expectText('kept from the last 60 s');
  await expectText(/ready in [\d.]+ s/, 'kept take is polished', 30000);
  await tap('Take 1');
  await expectText(/ready in [\d.]+ s/, 'switching takes renders', 30000);
  await tap('Pause', { optional: true });
  await tapTrack('Position in take', 0.75);
  let at = await trackAt('Position in take');
  log(Math.abs(at - 75) <= 3, 'tapping the track while paused moves there', `at ${at}%`);
  await tap('Play');
  await sleep(600);
  await tapTrack('Position in take', 0.2);
  at = await trackAt('Position in take');
  log(at >= 18 && at <= 45, 'tapping the track during playback jumps there', `at ${at}%`);
  await tap('Pause');

  await tap('Tweak it', { exact: false });
  await tap('Advanced: EQ', { exact: false });
  await expectText('Starting from what Auto chose for this take', 'advanced shows the automatic chain', 15000);
  await shot('11-advanced');
  await slide('Gain', 0.9);
  await expectText('Set by hand', 'editing a band marks the chain as set by hand', 5000);
  await tap('Compressor', { exact: false });
  await slide('Threshold', 0.3);
  await tap('Save as my preset');
  await expectText('Saved as my preset');
  await tap('Reset');
  await expectText('Starting from what Auto chose', 'reset returns to the automatic chain', 5000);
  await tap('Master');
  await tap('EQ', { exact: false });
  await slide('Gain', 0.7);
  await shot('12-advanced-master');

  await tap('Next: Master');
  await expectText('Set by hand', 'master screen says the chain was set by hand');
  await tap('Punchy');
  await expectText('Slower compressor attack', 'choosing a style explains itself', 20000);
  await slide('Intensity', 1);
  await expectText('100%');
  await slide('Low', 0.75);
  await expectText(/−\d+\.\d LUFS/, 'loudness is reported', 30000);
  await sleep(1500);
  await shot('13-master');
  await tap('Original');
  await tap('Mastered');
}

const DOWNLOADS = path.join(SHOTS, 'downloads-' + Date.now());
fs.mkdirSync(DOWNLOADS, { recursive: true });
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true });
const downloads = () => fs.readdirSync(DOWNLOADS).filter((f) => !f.endsWith('.crdownload'));
async function waitDownloads(count, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until && downloads().length < count) await sleep(200);
  return downloads();
}
/** Clicks a control that opens a file picker and answers it with a file. */
async function choose(label, file) {
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), tap(label)]);
  await chooser.accept([file]);
}
const PHOTO = path.resolve('../src/assets/covers/street.jpg');
/** File names inside a ZIP, read from its central directory. */
function unzipNames(file) {
  const b = fs.readFileSync(file);
  const names = [];
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = b.readUInt32LE(end + 16);
  for (let n = b.readUInt16LE(end + 10); n > 0; n--) {
    const len = b.readUInt16LE(p + 28);
    names.push(b.toString('utf8', p + 46, p + 46 + len));
    p += 46 + len + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return names;
}

async function finish() {
  await tap('Export');
  await expectText('Loud, for socials and demos', 'export screen opens');
  await tap('Loud, for socials and demos');
  await tap('Vocals only');
  await tap('WAV, 16-bit');
  await shot('14-export');
  // Chrome offers a share sheet, so saving is the second button; without one it is the only button.
  if (!(await tap('Save to Files', { optional: true }))) await tap('Save 3 files');
  await expectText('3 files saved to your downloads as Night bus.zip', 'export finishes', 60000);
  const files = await waitDownloads(1);
  const names = files.includes('Night bus.zip') ? unzipNames(path.join(DOWNLOADS, 'Night bus.zip')) : [];
  log(names.length === 3 && names.every((n) => n.endsWith('.wav')), 'the ZIP holds three WAV files', names.join(', ') || files.join(', '));
  // Then one file on its own, to check the audio itself.
  await tap('Vocals only');
  await tap('Instrumental, mastered to match');
  if (!(await tap('Save to Files', { optional: true }))) await tap('Save 1 file');
  await expectText('Saved Night bus.wav to your downloads', 'a single file is saved as it is', 60000);
  await waitDownloads(2);
  const header = fs.existsSync(path.join(DOWNLOADS, 'Night bus.wav')) ? fs.readFileSync(path.join(DOWNLOADS, 'Night bus.wav')) : null;
  log(!!header && header.toString('latin1', 0, 4) === 'RIFF' && header.readUInt16LE(34) === 16 && header.readUInt16LE(22) === 2, 'the song is a 16-bit stereo WAV', header ? `${header.length} bytes` : 'missing');

  await tap('Add cover art and play it');
  await expectText('Add a photo of yourself', 'cover screen asks for a photo');
  await shot('15-cover-empty');
  await choose('Choose a photo', PHOTO);
  const found = await waitFor(/Same person, same pose|colour treatment/i, 90000);
  log(found, 'photo is turned into scenes', found ? ((await text()).includes('Same person') ? 'person cut out' : 'no cut-out: colour treatments used') : (await text()).replace(/\s+/g, ' ').slice(0, 300));
  await shot('16-cover-photo');
  await tap('Studio');
  await sleep(400);
  await shot('17-cover-studio');
  await tap('Rooftop');
  await sleep(400);
  await shot('18-cover-rooftop');
  await tap('Stage');
  await sleep(400);
  await shot('19-cover-stage');
  await tap('Set as cover and backdrop');
  await expectText('Prod. Lowkey', 'player shows the credit', 15000);
  await expectText(/Mastered · Punchy · −\d+ LUFS/i, 'player shows the master', 30000);
  await sleep(1500);
  log(await transportPlaying(), 'the song plays in the player');
  await shot('20-player');
  await tap('Lyrics');
  await type('Lyrics', 'Night bus rolling, city on mute\nEvery red light is a breath I use');
  await tap('Done');
  await tap('Pause');

  await tap('Snippet');
  await expectText('Strongest stretch picked', 'snippet finds its stretch', 30000);
  await expectText('Night bus rolling, city on mute', 'caption defaults to the first lyric line');
  await shot('21-snippet');
  if (!(await tap('Save video', { optional: true }))) await tap('Share video');
  await expectText(/Saved Night bus snippet\.(mp4|webm) to your downloads/i, 'snippet video is recorded', 60000);
  const video = (await waitDownloads(3)).find((f) => /snippet\.(mp4|webm)$/.test(f));
  log(!!video && fs.statSync(path.join(DOWNLOADS, video)).size > 20000, 'snippet video file was written', video ? `${video}, ${fs.statSync(path.join(DOWNLOADS, video)).size} bytes` : 'missing');
  await tap('Save to the vault');
  await expectText('Search your bars', 'vault opens');
  await expectText('Snippet made');
  await shot('22-vault');
  await type('Search your bars', 'red light');
  await expectText('Night bus · Take', 'search finds a word in the lyrics');
  await type('Search your bars', 'zzzz');
  await expectText('Nothing in the vault matches');
  await type('Search your bars', '');
  await tap('Send stems to an engineer');
  await expectText('stems.zip to your downloads', 'stems are saved', 30000);
  const stemZip = (await waitDownloads(4)).find((f) => f.endsWith('stems.zip'));
  const stemNames = stemZip ? unzipNames(path.join(DOWNLOADS, stemZip)) : [];
  log(stemNames.length === 3, 'the stems ZIP holds the beat and both vocals', stemNames.join(', '));
}

async function library() {
  await tap('Home');
  await expectText('FREESTYLE OVER', 'home shows the latest beat');
  await expectText('3 takes');
  await expectText('Mastered · open the player');
  await shot('23-home');
  await tap('Settings');
  await expectText('Timing');
  await expectText('Everything is backed up', 'the library is backed up to the server', 30000);
  await shot('24-settings');

  // The same guided setup the welcome ends with can be run again from Settings.
  await tap('Walk me through the setup again');
  await expectText('Sound check', 'setup opens from Settings');
  await tap('Connect an input', { optional: true });
  await expectText('Connected', 'input connects in setup');
  await tap('Continue');
  await expectText('Line up your takes');
  await shot('24b-setup-timing');
  await tap('Done');
  await expectText('Backup', 'setup returns to Settings');
  await tap('Home');

  // Everything survives a reload.
  await page.reload({ waitUntil: 'networkidle2' });
  await expectText('FREESTYLE OVER', 'the library is still there after a reload', 30000);
  await expectText('Night bus');

  // Capture a beat from the input (the test tone stands in for an MPC).
  await tap('Capture from MPC');
  await tap('Connect', { optional: true });
  await expectText('Connected', 'capture screen connects', 10000);
  await tap('Arm recording');
  await expectText('Recording', 'recording starts at the first sound', 8000);
  await sleep(4500);
  await shot('25-record');
  await tap('Stop recording');
  await expectText('Beat captured', 'captured beat is saved', 20000);
  await expectText('What next?');
  await shot('26-captured');
  // Master it as an instrumental.
  await tap('Master the beat', { exact: false });
  await expectText(/−\d+\.\d LUFS/, 'an instrumental can be mastered on its own', 30000);
  await tap('Back');
  await expectText('What next?');
  await tap('Delete this beat');
  await tap('Tap again to delete this beat', { exact: false });
  await expectText('FREESTYLE OVER', 'deleting a beat returns home', 10000);
  const body = await text();
  log(!/Untitled beat/.test(body), 'the deleted beat is gone from the list');

  // Import one of the exported files as a new beat.
  await choose('Import a file', path.join(DOWNLOADS, 'Night bus.wav'));
  await expectText('Beat imported', 'an imported file becomes a beat', 30000);
  await expectText(/\d+ BPM/, 'a tempo is found for it');
  await shot('27-imported');

  // A beat at a different sample rate from the microphone: the audio clock is rebuilt at the
  // beat's rate, and recording and playback still have to work.
  const rate = 48000, bpm = 100, beatSec = 60 / bpm;
  const pcm = new Int16Array(rate * 10);
  for (let b = 0; b < 16; b++) {
    const at = Math.round(b * beatSec * rate);
    for (let i = 0; i < 6000 && at + i < pcm.length; i++) pcm[at + i] += Math.round(22000 * Math.sin((2 * Math.PI * (b % 2 ? 180 : 55) * i) / rate) * Math.exp(-i / 900));
    const off = Math.round((b + 0.5) * beatSec * rate);
    for (let i = 0; i < 900 && off + i < pcm.length; i++) pcm[off + i] += Math.round(6000 * (((i * 7919) % 13) / 13 - 0.5) * Math.exp(-i / 200));
  }
  const wav48 = Buffer.alloc(44 + pcm.length * 2);
  wav48.write('RIFF', 0); wav48.writeUInt32LE(36 + pcm.length * 2, 4); wav48.write('WAVEfmt ', 8); wav48.writeUInt32LE(16, 16);
  wav48.writeUInt16LE(1, 20); wav48.writeUInt16LE(1, 22); wav48.writeUInt32LE(rate, 24); wav48.writeUInt32LE(rate * 2, 28);
  wav48.writeUInt16LE(2, 32); wav48.writeUInt16LE(16, 34); wav48.write('data', 36); wav48.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer).copy(wav48, 44);
  fs.writeFileSync(path.join(DOWNLOADS, 'Basement tape.wav'), wav48);
  await tap('Home');
  await choose('Import a file', path.join(DOWNLOADS, 'Basement tape.wav'));
  await expectText('Beat imported', 'a 48 kHz file is imported', 30000);
  await expectText('100 BPM', 'its tempo is found');
  await expectText('48 kHz');
  await tap('Freestyle over it', { exact: false });
  await expectText('Mic: Fake', 'the microphone reconnects for the new beat', 10000);
  await tap('Start recording');
  await expectText(/Bar \d+ · pass 1/, 'recording runs at the beat\'s rate', 8000);
  await sleep(3500);
  await tap('Done, hear it back');
  await expectText('Take 1', 'the take opens in playback', 10000);
  await expectText(/ready in [\d.]+ s/, 'and is polished', 30000);
  log(await transportPlaying(), 'and plays');
  await shot('28-playback-48k');
}

const flows = { onboarding, song, finish, library };
const order = flow === 'all' ? Object.keys(flows) : flow.split(',');
try {
  for (const name of order) {
    console.log(`\n== ${name}`);
    await flows[name]();
  }
} catch (e) {
  log(false, 'run', String(e).slice(0, 400));
  await shot('crash');
}
if (problems.length) {
  failed++;
  console.log(`\nBrowser problems (${problems.length}):\n` + [...new Set(problems)].slice(0, 12).join('\n'));
}
if (process.env.CHATTER) console.log('\nConsole warnings and errors:\n' + [...chatter].join('\n'));
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
await browser.close();
process.exit(failed ? 1 : 0);
