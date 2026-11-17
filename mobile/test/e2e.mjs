// End-to-end run of the web app in headless Chrome, with a fake microphone
// (Chrome's built-in test tone) standing in for real audio input.
// Usage: node test/e2e.mjs [flow]   Screenshots go to $SHOTS (default ./.e2e).
// VIEW=<width>x<height> sets the window size (default 390x844, a phone).
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
// VIEW=1194x834 runs the same flows in the wide (tablet, landscape) layout.
const [viewWidth, viewHeight] = (process.env.VIEW ?? '390x844').split('x').map(Number);
// In the wide layout some things the phone tucks away are always on show, so the taps that reveal them are skipped.
const WIDE = viewWidth >= 1000 && viewWidth > viewHeight;
// Something only the Vault says: the phone labels its search field, the wide layout does not need to.
const IN_VAULT = WIDE ? 'Removing a song here' : 'Search your songs';
await page.setViewport({ width: viewWidth, height: viewHeight, deviceScaleFactor: 2 });
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
/** Opens a finished song from the Vault: in the full-screen player on a phone, in the docked player when wide. */
const openSong = (name) => tap(WIDE ? `Play ${name}` : `Open ${name}`);

/** Clicks the last visible control whose label or text matches. */
/** Waits out the count-in, so a take has really started before the test carries on. */
async function counted() {
  await sleep(500);
  for (let i = 0; i < 60 && /Count-in/.test(await text()); i++) await sleep(250);
}

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
  // Bring it to the middle first, clear of the bars pinned to the top and bottom of the screen.
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await el.click();
  // Select what is there so typing replaces it; a triple click only picks one line or word.
  await el.evaluate((n) => n.select());
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
/** Puts a finger down on a slider (found by its label), away from its thumb, and drags up the page, as scrolling does. */
async function scrollOver(label) {
  const box = await page.evaluate((label) => {
    const n = [...document.querySelectorAll('[role=slider]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop();
    if (!n) return null;
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, label);
  if (!box) return log(false, `scroll over "${label}"`, 'no such slider');
  const x = box.x + box.w * 0.15;
  const y = box.y + box.h / 2;
  const finger = await page.touchscreen.touchStart(x, y);
  for (let i = 1; i <= 8; i++) {
    await finger.move(x + (i % 2), y - i * 14);
    await sleep(16);
  }
  await finger.end();
  await sleep(300);
}
/** Drags a row (found by its label) to the left, as a finger would, to show its Delete button. */
async function swipeLeft(label) {
  const box = await page.evaluate((label) => {
    const n = [...document.querySelectorAll('[role=button],[role=radio]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop();
    if (!n) return null;
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, label);
  if (!box) return log(false, `swipe "${label}"`, 'no such row');
  const y = box.y + box.h / 2;
  if (process.env.SWIPE === 'mouse') {
    await page.mouse.move(box.x + box.w - 30, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w - 180, y, { steps: 8 });
    await page.mouse.up();
  } else {
    const finger = await page.touchscreen.touchStart(box.x + box.w - 30, y);
    for (let i = 1; i <= 8; i++) {
      await finger.move(box.x + box.w - 30 - i * 19, y);
      await sleep(16);
    }
    await finger.end();
  }
  await sleep(400);
}
const enabled = (label) => page.evaluate((label) => [...document.querySelectorAll('[role=button]')].some((n) => n.getAttribute('aria-label') === label && n.getAttribute('aria-disabled') !== 'true' && n.getBoundingClientRect().width > 0), label);
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
  // A build with a server offers an account next; it is optional.
  if (await waitFor('Keep it yours', 3000)) {
    await shot('02b-account');
    await tap('Not now');
  }
  await expectText('Sound check');
  await tap('Connect an input');
  await expectText('Connected', 'input connects');
  await sleep(1200);
  await shot('03-soundcheck');
  await tap('Continue');
  await expectText('Line up your takes');
  await expectText(/An estimate for .+\./, 'the timing step starts from an estimate for the connected setup');
  await shot('04a-timing-estimate');
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
  // A demo can be heard before it is added.
  const has = (label) => page.evaluate((label) => [...document.querySelectorAll('[role=button]')].some((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label), label);
  await tap('Preview Small Steps, Big City');
  let previewing = false;
  for (let i = 0; i < 40 && !previewing; i++) (previewing = await has('Pause Small Steps, Big City')) || (await sleep(500));
  log(previewing, 'a demo plays as a preview before it is added');
  await tap('Add Small Steps, Big City');
  await expectText('No takes yet', 'a demo song opens on the Song tab', 30000);
  // With no take yet, the beat can still be played from the Song tab.
  await tap('Play the beat');
  let beatPlaying = false;
  for (let i = 0; i < 20 && !beatPlaying; i++) (beatPlaying = await has('Pause the beat')) || (await sleep(500));
  log(beatPlaying, 'the beat plays from the Song tab before any take');
  await tap('Pause the beat', { optional: true });
  await expectText('94 BPM', 'and keeps the tempo it was written at');
  await page.goto(BASE + '/demos', { waitUntil: 'networkidle2', timeout: 120000 });
  await expectText('Ready-made beats', 'the demo songs open again');
  // The wide layout shows one group of demos at a time; the built-in beat is behind its own chip.
  await tap('Built in', { optional: true });
  await tap('Add Night bus');
  await expectText('No takes yet', 'a demo beat opens on the Song tab', 20000);
  await expectText('92 BPM', 'tempo detected');
  await expectText('F minor', 'key detected');
  await shot('06-beat');
}

/** Reads the engine's playback clock by sampling the time shown in the compact transport. */
const transportPlaying = () => state(() => !![...document.querySelectorAll('[role=button]')].filter((n) => n.getBoundingClientRect().width > 0).find((n) => n.getAttribute('aria-label') === 'Pause'));

async function song() {
  // Nothing is recorded yet: Song opens the song and says so, and Mix says there is nothing to mix and leads to the mic.
  await tap('Song');
  await expectText('No takes yet', 'Song opens the song before anything is recorded');
  await shot('06b-song-empty');
  await tap('Mix');
  await expectText('Nothing to mix yet', 'Mix stays on its own tab and says why it is empty');
  log(await state(() => { const lit = (name) => getComputedStyle([...document.querySelectorAll('[role=tab]')].find((n) => n.getAttribute('aria-label') === name)).backgroundColor !== 'rgba(0, 0, 0, 0)'; return lit('Mix') && !lit('Song'); }), 'the Mix tab is the one lit');
  await tap('Record a take');
  await expectText('Always listening', 'vocals screen opens');
  await expectText(/Fake .* ms (estimated|measured)/, 'microphone connects by itself once allowed', 8000);
  await shot('07-vocals-idle');
  // A new beat plays through whole until a loop is chosen.
  await expectText('Whole beat · once through', 'a new beat starts as the whole beat');
  await tap('8 bars');
  await tap('Start recording');
  await expectText(/Bar \d+ · pass 1/, 'recording shows the bar and pass after the count-in', 12000);
  await sleep(2500);
  await shot('08-vocals-recording');
  await sleep(4000);
  await tap('Done, hear it back');
  await expectText('Take 1', 'playback opens on the new take', 10000);
  await expectText(/Polished\s/, 'polish finishes', 30000);
  log(await transportPlaying(), 'the polished take plays by itself');
  // The take is a few seconds long; with Repeat on, the mix is still going well after it would have ended.
  await sleep(9000);
  log(await transportPlaying(), 'the mix repeats while it is being shaped');
  await tap('Repeat');
  await sleep(9000);
  log(!(await transportPlaying()), 'with Repeat off it stops at the end');
  await tap('Repeat');
  await tap('Play');
  await sleep(500);
  await shot('09-playback');
  await tap('Compare with raw');
  await sleep(300);
  await tap('Compare with raw');
  await tap('Melodic');
  await expectText(/Updating…|Polishing…/, 'changing the style re-renders', 4000);
  await expectText(/Polished\s/, 'second polish finishes', 30000);
  await expectText('Double track, nudged and panned');
  await slide('Vocal level', 0.9);
  await expectText(/Polished\s/, 'vocal level change renders', 30000);
  await shot('10-playback-tweak');

  // A second take, then punch in over it.
  // The mic in the bar is how another take is recorded from the song page.
  await tap('Freestyle over Night bus');
  await expectText('Always listening');
  await tap('Punch in at bar 5', { exact: false });
  await tap('Start recording');
  await counted();
  await sleep(4500);
  await tap('Stop recording');
  await expectText('Take 2 saved', 'second take is saved in place', 10000);
  // Listening mode: hold what was played, then keep it.
  await tap('Play the loop');
  await expectText('Holding the last', 'listening holds the input', 5000);
  await sleep(3500);
  await tap('Keep that');
  await expectText('Take 3', 'kept take opens in playback', 10000);
  await expectText(/Take 3 · 0:0\d/, 'the mix is of the kept take');
  await expectText(/Polished\s/, 'kept take is polished', 30000);
  await tap('Pause', { optional: true });
  // The Song tab lists every take; tapping one picks it and plays it polished over the beat.
  await tap('Song');
  await expectText('3 takes', 'Song lists the takes');
  await expectText(/kept · picked/, 'and marks the one that is picked');
  // Swiping a take shows Delete without deleting; tapping the row closes it again.
  log(!(await enabled('Delete take 2')), 'Delete is out of reach until a take is swiped');
  await swipeLeft('Take 2');
  log(await enabled('Delete take 2'), 'swiping a take shows Delete');
  log(/kept · picked/.test(await text()), 'and does not also pick the take');
  await shot('10a-swipe-take');
  await tap('Close');
  await sleep(300);
  log(!(await enabled('Delete take 2')), 'tapping the row closes it');
  await expectText('3 takes', 'and nothing was deleted');
  await tap('Take 1');
  await expectText('Take 1, polished over the beat', 'picking a take renders it', 30000);
  let started = false;
  for (const until = Date.now() + 30000; Date.now() < until && !(started = await transportPlaying()); ) await sleep(200);
  log(started, 'and plays it once it is ready');
  await shot('10b-song');
  await type('Lyrics', 'Night bus rolling, city on mute\nEvery red light is a breath I use');
  await tap('Pause', { optional: true });
  await tap('Mix take 1');
  await expectText(/Polished\s/, 'switching takes renders', 30000);
  // The part of the beat under the take can be changed in the mix.
  await expectText('on loop', 'the mix shows which bars of the beat are looping');
  await tap('Whole beat');
  await expectText('whole beat, once through', 'the beat section can be changed');
  await expectText(/Polished\s/, 'and the mix renders with it', 30000);
  await tap('8 bars');
  await expectText('on loop');
  await expectText(/Polished\s/, 'the loop is put back', 30000);
  await sleep(400);
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

  // The chains sit on the song page itself: EQ, compressor, de-esser and limiter for vocal, beat and master.
  await expectText('Starting from what Auto chose for this take', 'the song page shows the automatic chain', 15000);
  await shot('11-advanced');
  await slide('Gain', 0.9);
  await expectText('Set by hand', 'editing a band marks the chain as set by hand', 5000);
  await tap('Compressor', { exact: false, optional: WIDE });
  await slide('Threshold', 0.3);
  await tap('Save as my preset');
  await expectText('Saved as my preset');
  await tap('Reset');
  await expectText('Starting from what Auto chose', 'reset returns to the automatic chain', 5000);
  await tap('Master');
  await tap('EQ', { exact: false, optional: WIDE });
  await slide('Gain', 0.7);
  await shot('12-advanced-master');

  // The master is chosen here too: a style and how hard it is pushed. Choosing one replaces the chain set by hand.
  await expectText('Set by hand', 'the master chain is marked as set by hand');
  await tap('Punchy');
  await expectText('Slower compressor attack', 'choosing a master style explains itself', 20000);
  await expectText('Starting from the Punchy master');
  // A finger that lands on a slider while scrolling the page must not move it.
  const intensityBefore = await trackAt('Intensity');
  await scrollOver('Intensity');
  log((await trackAt('Intensity')) === intensityBefore, 'scrolling the page over a slider leaves it where it was', `${intensityBefore} -> ${await trackAt('Intensity')}`);
  await slide('Intensity', 1);
  await expectText('100%');
  await expectText(/Polished\s/, 'the mix renders with the master', 30000);
  await sleep(800);
  await shot('13-mix-master');
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
  // Nothing is finished yet: the Vault says so and leads back to the song page.
  await tap('Vault');
  await expectText('Nothing finished yet', 'the Vault starts empty');
  await shot('13b-vault-empty');
  await tap('Open your song');
  await expectText('Not in the Vault yet', 'the Vault leads to the song, which says it is not finished');
  await expectText('Has lyrics');
  await expectText('on loop', 'the song page has the same repeat and bar controls as the mix');
  await tap('Repeat');
  await tap('Repeat');
  await shot('13b-song-transport');
  await tap('Mix take 1');
  await expectText(/Polished\s/, 'the mix opens from the song', 30000);
  await shot('13c-mix');
  await expectText(/Reverb 60% · Echo off/i, 'the vocal reverb starts where the style puts it');
  await tap('Reverb and echo', { exact: false, optional: WIDE });
  await expectText('Room cut', 'reverb, echo and room cut are on the mix page');
  await slide('Echo', 0.3);
  // The wide layout's sliders are shorter, so the same drag lands a step either side.
  await expectText(WIDE ? /Echo (29|30|31)%/i : /Echo 30%/i, 'echo can be added to the vocal');
  await expectText(/Polished\s/, 'and the mix renders with it', 30000);
  await tap('Reverb and echo', { exact: false, optional: WIDE });
  await tap('Send stems to an engineer');
  await expectText('stems.zip to your downloads', 'stems are saved from the song page', 30000);
  const stemZip = (await waitDownloads(1)).find((f) => f.endsWith('stems.zip'));
  const stemNames = stemZip ? unzipNames(path.join(DOWNLOADS, stemZip)) : [];
  log(stemNames.length === 3, 'the stems ZIP holds the beat and both vocals', stemNames.join(', '));
  // Finish song goes straight to naming it; there is no second mixing step in between.
  await tap('Finish song');
  await expectText('Save to the Vault', 'Finish song opens the last step directly');
  await expectText('Add a photo of the artist');
  await expectText('Add a photo of the artist', 'and asks for a cover photo');
  await type('Song title', 'Night bus');
  await type('Artist on this song', 'Mina Cole');
  await expectText('Add a photo of Mina Cole', 'the photo is asked for by the artist\'s name');
  await expectText('Choose a photo', 'with one button to choose or take it');
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
  await tap('Save to the Vault');
  await expectText('Prod. Lowkey', 'the finished song opens in the player', 15000);
  await expectText('Mina Cole · Prod. Lowkey', 'the song is credited to the artist on it');
  await expectText(/Mastered · Punchy · −\d+ LUFS/i, 'player shows the master', 30000);
  await sleep(1500);
  log(await transportPlaying(), 'the song plays in the player');
  await shot('20-player');
  // Files are shared or saved from a finished song, after choosing what and how.
  await tap('Share');
  await expectText('Loud, for socials and demos', 'Share on a finished song opens the choices first');
  await tap('Loud, for socials and demos');
  await tap('Vocals only');
  await tap('WAV, 16-bit');
  await shot('14-export');
  // Chrome offers a share sheet, so saving is the second button; without one it is the only button.
  if (!(await tap('Save to Files', { optional: true }))) await tap('Save 3 files');
  await expectText('3 files saved to your downloads as Night bus.zip', 'export finishes', 60000);
  const files = await waitDownloads(2);
  const names = files.includes('Night bus.zip') ? unzipNames(path.join(DOWNLOADS, 'Night bus.zip')) : [];
  log(names.length === 3 && names.every((n) => n.endsWith('.wav')), 'the ZIP holds three WAV files', names.join(', ') || files.join(', '));
  // Then one file on its own, to check the audio itself.
  await tap('Vocals only');
  await tap('Instrumental, mastered to match');
  if (!(await tap('Save to Files', { optional: true }))) await tap('Save 1 file');
  await expectText('Saved Night bus.wav to your downloads', 'a single file is saved as it is', 60000);
  await waitDownloads(3);
  const header = fs.existsSync(path.join(DOWNLOADS, 'Night bus.wav')) ? fs.readFileSync(path.join(DOWNLOADS, 'Night bus.wav')) : null;
  log(!!header && header.toString('latin1', 0, 4) === 'RIFF' && header.readUInt16LE(34) === 16 && header.readUInt16LE(22) === 2, 'the song is a 16-bit stereo WAV', header ? `${header.length} bytes` : 'missing');
  await tap('Back');
  await expectText('Prod. Lowkey', 'Back returns to the player');
  // The wide player always shows the lyrics; the phone keeps them behind a button.
  await tap('Lyrics', { optional: WIDE });
  await expectText('Every red light is a breath I use', 'the lyrics written on the song came with it');
  await tap('Done', { optional: WIDE });
  await tap('Pause', { optional: true });

  await tap('Snippet');
  await expectText('Strongest stretch picked', 'snippet finds its stretch', 30000);
  // The stretch can be moved along the song, and put back.
  if (await state(() => !![...document.querySelectorAll('[role=slider]')].find((n) => n.getAttribute('aria-label') === 'Snippet position'))) {
    await tapTrack('Snippet position', 0.2);
    await expectText('Your pick', 'the snippet can be moved to another part of the song', 5000);
    await tap('Strongest stretch');
    await expectText('Strongest stretch picked', 'and put back on the strongest stretch', 5000);
  }
  log((await state(() => [...document.querySelectorAll('textarea')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === 'Caption line').pop()?.value ?? '')) === 'Night bus rolling, city on mute', 'the caption on the card starts as the first lyric line, and is edited there');
  await shot('21-snippet');
  // The snippet is made first; saving or sharing it is then one more tap.
  await tap('Make snippet');
  await expectText('Snippet ready', 'the snippet video is made', 60000);
  // The buttons stay off for a moment after the snippet is made, while that work winds up.
  await sleep(500);
  await tap('Save snippet');
  await expectText(/Saved Night bus snippet\.(mp4|webm) to your downloads/i, 'snippet video is recorded', 60000);
  const video = (await waitDownloads(4)).find((f) => /snippet\.(mp4|webm)$/.test(f));
  log(!!video && fs.statSync(path.join(DOWNLOADS, video)).size > 20000, 'snippet video file was written', video ? `${video}, ${fs.statSync(path.join(DOWNLOADS, video)).size} bytes` : 'missing');
  await tap('Done, back to the Vault');
  await expectText(IN_VAULT, 'vault opens');
  await expectText('Snippet made');
  await expectText('Last played', 'the Vault marks the song played last');
  await shot('22-vault');
  // A song's dot menu leads to its cover, loaded to change, and back.
  if (!WIDE) {
    await tap('More for Night bus');
    await tap('Edit image');
    await expectText('Cover art', 'Edit image opens the cover screen for that song', 10000);
    await tap('Skip');
    await expectText('Prod. Lowkey', 'and leaving it returns to the song', 15000);
    await tap('Close the player');
    await expectText(IN_VAULT, 'then back to the Vault');
  }
  await type('Search your songs', 'red light');
  await expectText('Has lyrics', 'search finds a word in the lyrics');
  await type('Search your songs', 'zzzz');
  await expectText('Nothing in the vault matches');
  await type('Search your songs', '');
  // A finished song opens in the full-screen player, with no navigation around it, and closes back to the Vault.
  await openSong('Night bus');
  if (WIDE) await tap('Open the player full screen');
  await expectText('Prod. Lowkey', 'a Vault song opens in the player', 15000);
  log(await state(() => ![...document.querySelectorAll('[role=tab]')].some((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === 'Song')), 'the player is full screen');
  await tap('Close the player');
  await expectText(IN_VAULT, 'closing the player returns to the Vault');
  // The finished song is its own copy: the beat keeps all three takes.
  await tap('Song');
  await expectText('3 takes', 'Song opens the beat the finished song came from', 10000);
  await expectText('In the Vault', 'and says it has been finished');
  await tap('Mix');
  await expectText(/Take 1 · 0:0\d/, 'Mix opens the same beat', 10000);
}

async function library() {
  // Home lists the beats still being worked on, so one whose song is in the Vault leaves it.
  await tap('Home');
  await expectText('1 beat has a finished song', 'a beat with a song in the Vault leaves Home');
  log(await state(() => ![...document.querySelectorAll('[role=button]')].some((n) => n.getAttribute('aria-label') === 'Open Night bus')), 'and Home no longer lists it');
  await shot('23-home-done');
  // Its song in the Vault leads back to the beat, and recording over it again brings it back.
  await tap('Vault');
  await openSong('Night bus');
  await tap('Record another version');
  await expectText('Always listening', 'a finished song leads back to its beat', 10000);
  await sleep(800);
  await tap('Start recording');
  await counted();
  await sleep(3000);
  await tap('Stop recording');
  await expectText('Take 4 saved', 'another take is recorded over it', 10000);
  await tap('Home');
  await expectText('FREESTYLE OVER', 'and the beat is back on Home');
  await expectText('4 takes');
  await shot('23-home');
  // Home leads with the ways to bring a beat in.
  await expectText('Add a beat', 'home offers the ways to add a beat');
  await tap('Add a demo song');
  await expectText('Ready-made beats', 'and leads into the demo songs');
  await tap('Home');
  await expectText('Add a beat');
  await tap('Open Night bus');
  await expectText('Beat details', 'a beat opens its song', 10000);
  await tap('Home');
  // The personal menu in the top bar holds Profile and Settings.
  await tap('Your menu');
  await tap('Profile');
  await expectText('Used on a song', 'the personal menu opens the profile');
  await tap('Your menu');
  await tap('Settings');
  await expectText('Storage');
  await expectText('Everything is backed up', 'the library is backed up to the server', 30000);
  await shot('24-settings');

  // The microphone and its timing are set where recording happens, with the guided setup one tap away.
  await tap('Freestyle over Night bus');
  await tap('Microphone and timing', { exact: false });
  await expectText('Play the clicks', 'the mic screen holds the microphone and timing');
  await shot('24a-mic-setup');
  await tap('Walk me through the setup again');
  await expectText('Sound check', 'setup opens from the mic screen');
  await tap('Connect an input', { optional: true });
  await expectText('Connected', 'input connects in setup');
  await tap('Continue');
  await expectText('Line up your takes');
  await shot('24b-setup-timing');
  await tap('Done');
  await expectText('Always listening', 'setup returns to the mic screen');
  await tap('Home');

  // Everything survives a reload.
  await page.reload({ waitUntil: 'networkidle2' });
  await expectText('FREESTYLE OVER', 'the library is still there after a reload', 30000);
  await expectText('Night bus');

  // Capture a beat from the input (the test tone stands in for a sampler).
  await tap('Capture from your gear');
  await tap('Connect', { optional: true });
  await expectText('Connected', 'capture screen connects', 10000);
  await tap('Arm recording');
  await expectText('Recording', 'recording starts at the first sound', 8000);
  await sleep(4500);
  await shot('25-record');
  await tap('Stop recording');
  await expectText('Not in the Vault yet', 'a captured beat opens on the Song tab', 20000);
  // Its details, where it is named and mastered alone, open in place.
  await tap('Beat details', { exact: false });
  await expectText('Beat captured', 'captured beat is saved', 10000);
  await expectText('Master the beat', 'its details open inside the Song tab');
  await shot('26-captured');
  // Master it as an instrumental.
  await tap('Master the beat', { exact: false });
  await expectText(/−\d+\.\d LUFS/, 'an instrumental can be mastered on its own', 30000);
  await expectText('Save to the Vault', 'and saved to the Vault from there');
  // Master has no bottom bar on a phone; Back in its top corner returns to where it was opened.
  await tap('Back');
  await expectText('Not in the Vault yet', 'mastering the beat alone returns to its song');
  if (!(await tap('Delete this beat', { optional: true }))) {
    await tap('Beat details', { exact: false });
    await tap('Delete this beat');
  }
  await tap('Tap again to delete this beat', { exact: false });
  await expectText('FREESTYLE OVER', 'deleting a beat returns home', 10000);
  const body = await text();
  log(!/Untitled beat/.test(body), 'the deleted beat is gone from the list');

  // Import one of the exported files as a new beat.
  await choose('Import a file', path.join(DOWNLOADS, 'Night bus.wav'));
  await expectText('Not in the Vault yet', 'an imported file opens on the Song tab', 30000);
  await tap('Beat details', { exact: false });
  await expectText('Beat imported', 'an imported file becomes a beat', 10000);
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
  await expectText('Not in the Vault yet', 'a 48 kHz file is imported', 30000);
  await expectText('100 BPM', 'its tempo is found');
  await tap('Beat details', { exact: false });
  await expectText('48 kHz');
  await tap('Freestyle over Basement tape');
  await expectText(/Fake .* ms (estimated|measured)/, 'the microphone reconnects for the new beat', 10000);
  await tap('8 bars');
  await tap('Start recording');
  await expectText(/Bar \d+ · pass 1/, 'recording runs at the beat\'s rate', 12000);
  await sleep(3500);
  await tap('Done, hear it back');
  await expectText('Take 1', 'the take opens in playback', 10000);
  await expectText(/Polished\s/, 'and is polished', 30000);
  log(await transportPlaying(), 'and plays');
  await shot('28-playback-48k');

  // Swipe to delete: a take from the song, then the beat from Home.
  await tap('Song');
  await expectText('1 take', 'Song shows the new take');
  await swipeLeft('Take 1');
  await tap('Delete take 1');
  await expectText('1 take', 'the first tap on Delete only asks');
  await tap('Tap again to delete take 1');
  await expectText('No takes yet', 'swiping and tapping Delete removes a take', 10000);
  await tap('Home');
  await expectText('Add a beat', 'Home opens');
  await sleep(600); // let the screen change settle before dragging on it
  await swipeLeft('Open Basement tape');
  await shot('29-swipe-beat');
  await tap('Delete Basement tape', { exact: false });
  await tap('Tap again to delete Basement tape', { exact: false });
  await sleep(600);
  log(!/Basement tape/.test(await text()), 'swiping and tapping Delete removes a beat');
  await expectText('Night bus', 'and leaves the others');

  // With no beat left, Song, the mic and Mix stay on their own screens and offer to add one.
  for (let i = 0; i < 6; i++) {
    const left = await page.evaluate(() => [...document.querySelectorAll('[role=button]')].map((n) => n.getAttribute('aria-label') ?? '').filter((l) => l.startsWith('Open ')).map((l) => l.slice(5)));
    if (!left.length) break;
    await swipeLeft(`Open ${left[0]}`);
    await tap(`Delete ${left[0]}`, { exact: false });
    await tap(`Tap again to delete ${left[0]}`, { exact: false });
    await sleep(600);
  }
  await expectText('Bring a beat', 'home is empty once every beat is deleted');
  await tap('Song');
  await expectText('No song yet', 'Song stays put and says why it is empty');
  await expectText('Add a beat', 'and offers the ways to add a beat');
  await shot('30-no-song');
  await tap('Mix');
  await expectText('Nothing to mix yet', 'Mix does the same');
  await tap('Add a beat to freestyle');
  await expectText('Nothing to record over yet', 'and so does the mic');
  await tap('Try a demo song');
  await expectText('Ready-made beats', 'its tiles lead on, here to the demo songs');
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
