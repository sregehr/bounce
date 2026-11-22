// End-to-end run of the web app in headless Chrome, with a fake microphone
// (Chrome's built-in test tone) standing in for real audio input.
// Usage: node test/e2e.mjs [flow]   Screenshots go to $SHOTS (default ./.e2e).
// VIEW=<width>x<height> sets the window size (default 390x844, a phone).
import { spawnSync } from 'node:child_process';
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
const IN_VAULT = WIDE ? 'Deleting a song here' : 'Search your songs';
await page.setViewport({ width: viewWidth, height: viewHeight, deviceScaleFactor: 2 });
// TEXT=22.4px runs everything at a larger text size (16px is the usual; 22.4px is the largest the app follows), for looking over the screenshots.
if (process.env.TEXT) await page.evaluateOnNewDocument((size) => document.documentElement.style.setProperty('font-size', size), process.env.TEXT);
const problems = [];
const chatter = new Set();
page.on('console', (m) => {
  if (m.type() === 'warn' || m.type() === 'error') chatter.add(`${m.type()}: ${m.text().slice(0, 260)}`);
  // The segmentation library logs its start-up line as an error, and the browser's own
  // "failed to load" line carries no address; failed requests are listed with theirs below.
  if (m.type() === 'error' && !offline && !/TensorFlow Lite|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => !offline && problems.push(`error: ${String(e).slice(0, 300)}`));
page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/symbolicate') && problems.push(`http ${r.status()}: ${r.url().slice(0, 200)}`));

// Storage can be made to fail from a test. The switch lives in sessionStorage so it survives a reload:
// 'read' makes reading the library fail, 'write' makes storing audio fail.
await page.evaluateOnNewDocument(() => {
  const fault = () => {
    try {
      return window.__e2eRaw ? null : sessionStorage.getItem('e2e-fault');
    } catch {
      return null;
    }
  };
  const refuse = () => {
    throw new DOMException('Storage was made to fail for this test.', 'UnknownError');
  };
  const { get, put } = IDBObjectStore.prototype;
  IDBObjectStore.prototype.get = function (...args) {
    return fault() === 'read' && this.name === 'kv' ? refuse() : get.apply(this, args);
  };
  IDBObjectStore.prototype.put = function (...args) {
    return fault() === 'write' && this.name === 'blobs' ? refuse() : put.apply(this, args);
  };
});
const setFault = (kind) => page.evaluate((kind) => (kind ? sessionStorage.setItem('e2e-fault', kind) : sessionStorage.removeItem('e2e-fault')), kind);
/** What the app has saved under a key, read straight from the browser's storage, as JSON. `store` is 'kv', or 'blobs' for the names of the stored files. */
const stored = (key, store = 'kv') =>
  page.evaluate(
    (key, store) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('bounce');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          window.__e2eRaw = true;
          const request = store === 'kv' ? db.transaction('kv').objectStore('kv').get(key) : db.transaction('blobs').objectStore('blobs').getAllKeys();
          window.__e2eRaw = false;
          request.onerror = () => (db.close(), reject(request.error));
          request.onsuccess = () => (db.close(), resolve(JSON.stringify(request.result ?? null)));
        };
      }),
    key,
    store,
  );
// The backup server the app talks to, learnt from its own requests.
let serverOrigin = null;
page.on('request', (r) => {
  const hit = /^(https?:\/\/[^/]+)\/api\/(query|mutation)$/.exec(r.url());
  if (hit) serverOrigin = hit[1];
});
// While a test has the server cut off, the browser's complaints about that are expected.
let offline = false;

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

let restoreCode = '';
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
  // The page keeps its place as its content grows and shrinks, so it may move once more after being scrolled.
  // The slider is measured again once it has settled, so the drag starts on it and not on what slid under the pointer.
  await sleep(300);
  const settled = await page.evaluate((label) => {
    const n = [...document.querySelectorAll('[role=slider]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop();
    const r = n?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, label);
  if (settled) Object.assign(box, settled);
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
/**
 * Holds a finger on a slider (found by its label) and drags it sideways to a fraction of its width, or
 * up the page when `scroll` is set. Reports the value bubble as it is with the finger still down, then lifts.
 */
async function holdSlider(label, fraction, scroll = false, picture = null) {
  const box = await page.evaluate((label) => {
    const n = [...document.querySelectorAll('[role=slider]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop();
    if (!n) return null;
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, label);
  if (!box) return log(false, `hold "${label}"`, 'no such slider'), null;
  const x = box.x + box.w * 0.5, y = box.y + box.h / 2;
  const to = box.x + 9 + (box.w - 18) * fraction;
  const finger = await page.touchscreen.touchStart(x, y);
  for (let i = 1; i <= 8; i++) {
    await (scroll ? finger.move(x + (i % 2), y - i * 14) : finger.move(x + ((to - x) * i) / 8, y));
    await sleep(16);
  }
  await sleep(150);
  const seen = await page.evaluate((label) => {
    const n = document.querySelector('[data-testid=slider-bubble]');
    const slider = [...document.querySelectorAll('[role=slider]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop();
    const r = n?.getBoundingClientRect();
    const track = slider?.getBoundingClientRect();
    return { text: n?.innerText ?? null, left: r?.left, right: r?.right, bottom: r?.bottom, thumbTop: track ? track.top + track.height / 2 - 9 : 0, width: innerWidth, now: Number(slider?.getAttribute('aria-valuenow')) };
  }, label);
  if (picture) await shot(picture);
  await finger.end();
  await sleep(250);
  return { ...seen, gone: await page.evaluate(() => !document.querySelector('[data-testid=slider-bubble]')) };
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
/** Whether a control with this label or text is on screen. */
const shows = (label) =>
  page.evaluate((label) => [...document.querySelectorAll('[role=button],[role=link],[role=tab],[role=checkbox],a,button')].some((n) => n.getBoundingClientRect().width > 0 && getComputedStyle(n).visibility !== 'hidden' && [n.getAttribute('aria-label'), n.innerText?.trim()].includes(label)), label);
/** Whether the browser would ask before this tab is closed or reloaded: what a page does to keep a recording from being lost. */
const asksBeforeLeaving = () =>
  page.evaluate(() => {
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    return leaving.defaultPrevented;
  });
/** Opens the mic screen's On the mic row, if it is not open already. */
async function openSetup() {
  if (!(await showing('Back to recording'))) await tap('On the mic', { exact: false });
}
/** Steps back from On the mic to the recording screen, if it is open. */
async function closeSetup() {
  if (await showing('Back to recording')) await tap('Back to recording');
}
/** Opens Mix's Fine-tune level on a phone, if it is not open already. The wide layout shows both levels at once. */
async function openTune() {
  if (!WIDE && !(await showing('Back to the sound'))) await tap('Fine-tune', { exact: false });
}
/** Steps back from Fine-tune to the sound, if it is open. */
async function closeTune() {
  if (await showing('Back to the sound')) await tap('Back to the sound');
}
/** Opens a row that unfolds in place (Settings, Share), if it is not open already. */
async function openRow(title) {
  const closed = await page.evaluate((title) => [...document.querySelectorAll('[role=button]')].some((n) => n.getBoundingClientRect().width > 0 && (n.innerText ?? '').trim().startsWith(title) && n.getAttribute('aria-expanded') !== 'true'), title);
  if (closed) await tap(title, { exact: false });
  await sleep(350);
}
/** Whether a control with this label is on screen. */
const showing = (label, role) => page.evaluate((label, role) => [...document.querySelectorAll(role ? `[role=${role}]` : '[role=button],[role=link],[role=tab],[role=radio],[role=switch],button')].some((n) => n.getBoundingClientRect().width > 0 && (n.getAttribute('aria-label') ?? n.textContent ?? '').trim() === label), label, role);
const trackAt = (label) => page.evaluate((label) => Number([...document.querySelectorAll('[role=slider]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label).pop()?.getAttribute('aria-valuenow') ?? NaN), label);
/** What a slider (found by the start of its label) reads out to a screen reader. */
const valueText = (label) => page.evaluate((label) => [...document.querySelectorAll('[role=slider]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label')?.startsWith(label)).pop()?.getAttribute('aria-valuetext') ?? '', label);
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
  // First launch is one screen: what Bounce is, and the ways to bring a beat in. Nothing is asked before there is a beat.
  await expectText('Pick a beat to start', 'the welcome leads straight to adding a beat');
  log(!/What do you go by|Keep it yours|Sound check/.test(await text()) && !(await showing('Get started')), 'with no name, account or sound check in the way');
  await shot('01-welcome');
  await tap('Try a demo beat');
  await expectText('Ready-made beats', 'the demo songs are listed');
  await shot('05b-demo-songs');
  // A demo can be heard before it is added.
  const has = (label) => page.evaluate((label) => [...document.querySelectorAll('[role=button]')].some((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === label), label);
  await tap('Preview Small Steps, Big City');
  let previewing = false;
  for (let i = 0; i < 40 && !previewing; i++) (previewing = await has('Pause Small Steps, Big City')) || (await sleep(500));
  log(previewing, 'a demo plays as a preview before it is added');
  await tap('Add Small Steps, Big City');
  // A new beat opens on its Song page; recording a take from there leads to the mic, where the microphone is asked for.
  await expectText('Nothing recorded over this beat yet', 'a demo song opens on its Song page', 30000);
  await tap('Record a take');
  await expectText('On the mic', 'and Record a take leads to the mic screen', 10000);
  await expectText('Small Steps, Big City');
  await shot('02-mic-first');
  await tap('Connect a microphone', { optional: true });
  await expectText('Tap to record', 'the microphone connects on the mic screen', 10000);
  log(!/What do you go by/.test(await text()), 'the name is not asked for before there is a take');

  // Timing starts from an estimate; the check is one tap from the mic screen, as a sheet over it.
  await expectText(/Estimated, \d+ ms/, 'the mic screen shows the timing estimate and offers the check');
  await shot('03-mic-timing-row');
  await tap('Timing.', { exact: false });
  await expectText('Sound check', 'the setup sheet opens from the mic screen');
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
  // After a check whose clicks did not come back, clapping along is the button that leads.
  const clapAlong = async () => (await tap('Clap or tap along', { optional: true })) || (await tap('Wearing earbuds? Clap or tap along instead'));
  await clapAlong();
  await expectText('Clap on every click', 'the clap-along check opens');
  await sleep(2500);
  await shot('04b-clap-along');
  await expectText(/Measured from \d of 8 claps|claps lined up/, 'the clap-along check finishes', 12000);
  // The same check by tapping the circle on each click, for when clapping is not an option.
  await clapAlong();
  await expectText('Click 1 of 8', 'the check starts again', 8000);
  const disc = await page.evaluate(() => {
    const r = [...document.querySelectorAll('[role=button]')].find((n) => n.getAttribute('aria-label') === 'Tap on every click').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  // Steady taps, one a click: what matters is that they keep the pulse, as a person would.
  const firstTap = Date.now();
  for (let k = 0; k < 7; k++) {
    await sleep(Math.max(0, firstTap + k * 600 - Date.now()));
    await page.mouse.move(disc.x, disc.y);
    await page.mouse.down();
    await sleep(40);
    await page.mouse.up();
  }
  await expectText(/Measured from \d of 8 taps/, 'tapping the circle on each click sets the timing', 12000);
  log(await showing('Done'), 'with a measured figure, Done is the button that leads');
  await tap('Run it again');
  await expectText(/Heard all the clicks|clicks came back/i, 'the click check still runs afterwards', 12000);

  await sleep(300); // the check clears its busy state a moment after the result shows
  (await tap('Done', { optional: true })) || (await tap('Use the estimate'));
  await expectText('Tap to record', 'the setup sheet closes back to the mic screen', 10000);

  // The producer's name is kept on the profile; the artist's is asked for after the first take.
  await page.goto(BASE + '/profile', { waitUntil: 'networkidle2', timeout: 120000 });
  await expectText('Who makes your beats?', 'the profile holds the producer name');
  await type('Producer name', 'Lowkey');
  await tap('Song');
  await expectText('No takes yet', 'the Song tab opens the song before anything is recorded');
  // With no take yet, recording one is the button that leads; mastering the beat alone is in its details.
  log((await showing('Record a take')) && !(await showing('Master the beat')), 'and leads with recording a take');
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
  await expectText('Nothing recorded over this beat yet', 'a demo beat opens on its Song page', 20000);
  await expectText('92 BPM', 'tempo detected');
  await expectText('F minor', 'key detected');
  await shot('06-beat');
}

/** Reads the engine's playback clock by sampling the time shown in the compact transport. */
const transportPlaying = () => state(() => !![...document.querySelectorAll('[role=button]')].filter((n) => n.getBoundingClientRect().width > 0).find((n) => n.getAttribute('aria-label') === 'Pause'));

async function song() {
  // Nothing is recorded yet: Song opens the song and says so, and Mix has the beat by itself and leads to the mic.
  await tap('Song');
  await expectText('No takes yet', 'Song opens the song before anything is recorded');
  await shot('06b-song-empty');
  await tap('Mix');
  await expectText('The beat by itself', 'Mix stays on its own tab and mixes the beat alone');
  log(!(await showing('Upfront')), 'without the vocal styles');
  log(await state(() => { const lit = (name) => getComputedStyle([...document.querySelectorAll('[role=tab]')].find((n) => n.getAttribute('aria-label') === name)).backgroundColor !== 'rgba(0, 0, 0, 0)'; return lit('Mix') && !lit('Song'); }), 'the Mix tab is the one lit');
  await tap('Record a take');
  await expectText('On the mic', 'vocals screen opens');
  await expectText('Tap to record', 'microphone connects by itself once allowed', 8000);
  await shot('07-vocals-idle');
  // A new beat plays through whole until a loop is chosen.
  await expectText('Whole beat · once through', 'a new beat starts as the whole beat');
  // Which bars to record over is chosen here, on the mic screen.
  await tap('8 bars');
  await expectText(/Loop · bars 1–8/i, 'the bars to record over are chosen on the mic screen');
  log(await showing('Place in the loop', 'slider'), 'the loop is drawn as a waveform, as on the other tabs');
  log(await showing('Start recording') && !(await showing('Stop recording')), 'the record button is on the screen itself');
  await tap('Start recording');
  await expectText(/Bar \d+ · pass 1/, 'recording shows the bar and pass after the count-in', 12000);
  await sleep(2500);
  await shot('08-vocals-recording');
  // Going back mid-take would drop it, so the browser's Back button is held while one runs.
  await page.goBack().catch(() => {});
  await sleep(600);
  log(new URL(page.url()).pathname === '/vocals' && /Bar \d+ · pass \d/.test(await text()), 'Back does not leave the mic screen while a take is running', page.url());
  await sleep(3400);
  // One stop. The take is saved and stays on this screen, in a card that plays it and leads to the mix.
  await tap('Stop recording');
  await expectText(/Take \d+ saved/, 'stopping saves the take and shows it on the mic screen', 10000);
  await tap('Mix it');
  await expectText('Take 1', 'playback opens on the new take', 10000);
  await expectText(/Polished\s/, 'polish finishes', 30000);
  log(await transportPlaying(), 'the polished take plays by itself');
  // The take is a few seconds long; with Repeat on, the mix is still going well after it would have ended.
  await sleep(9000);
  log(await transportPlaying(), 'the mix repeats while it is being shaped');
  log(!(await showing('Repeat')) && !(await showing('8 bars')), 'the mix has no Repeat or bars of its own: a take always repeats, over the bars it was recorded on');
  await sleep(500);
  await shot('09-playback');
  // The raw take plays only while its button is held, so it cannot be left on.
  const rawBox = await page.evaluate(() => { const r = [...document.querySelectorAll('[role=button]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === 'Hold to hear it raw').pop()?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
  await page.mouse.move(rawBox.x, rawBox.y);
  await page.mouse.down();
  await sleep(400);
  log(/Playing it raw/.test(await text()), 'holding the raw button plays the raw take');
  await page.mouse.up();
  await sleep(300);
  log(!/Playing it raw/.test(await text()) && /Hold to hear it raw/.test(await text()), 'and letting go brings the polish back');
  log(!(await showing('Mix B')) && !(await showing('Save this mix')) && (await showing('Undo')) && (await showing('More for this mix')), 'the first level is the sound alone, with undo and a menu beside its status');
  await tap('Melodic');
  await expectText(/Updating…|Polishing…/, 'changing the style re-renders', 4000);
  await expectText(/Polished\s/, 'second polish finishes', 30000);
  await expectText('Double track');
  await slide('Vocal level', 0.9);
  await expectText(/Polished\s/, 'vocal level change renders', 30000);
  // Undo steps back through changes to the mix, and Redo forward again.
  const levelSet = await trackAt('Vocal level');
  await tap('Undo');
  await sleep(300);
  const levelUndone = await trackAt('Vocal level');
  log(levelUndone !== levelSet, 'Undo puts the vocal level back', `${levelSet} -> ${levelUndone}`);
  await tap('Redo');
  await sleep(300);
  log((await trackAt('Vocal level')) === levelSet, 'and Redo sets it again', `${await trackAt('Vocal level')}`);
  // A song has one mix. Fine-tune is the chains for it; there is no second mix to flip to and none to save by name.
  await openTune();
  await expectText('Starting from what Auto chose', 'Fine-tune holds the chains');
  log(!(await showing('Mix A')) && !(await showing('Mix B')) && !(await showing('Save this mix')) && !/Saved mixes|Compare/i.test(await text()), 'with no second mix and no saved mixes');
  await shot('10-fine-tune');
  await closeTune();
  await expectText('saved as you change it', 'the page says the mix is kept as it is changed');
  await slide('Vocal level', 0.5);
  await sleep(900);
  const levelMoved = await trackAt('Vocal level');
  log(levelMoved !== levelSet, 'a change is one more step to undo', `${levelSet} -> ${levelMoved}`);
  // A tap with two fingers undoes as well.
  const touch = await page.createCDPSession();
  const fingers = [{ x: 120, y: 300, id: 1 }, { x: 200, y: 310, id: 2 }];
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers });
  await sleep(60);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  await sleep(300);
  log((await trackAt('Vocal level')) === levelSet, 'a tap with two fingers undoes the last change', `${await trackAt('Vocal level')}`);
  // Undo steps are still there after a reload.
  await sleep(600);
  await page.reload({ waitUntil: 'networkidle2' });
  await expectText('Vocal level', 'the Mix page opens again after a reload', 30000);
  log((await trackAt('Vocal level')) === levelSet, 'with the mix as it was left, saved without being asked', `${await trackAt('Vocal level')}`);
  await tap('Redo');
  await sleep(300);
  log((await trackAt('Vocal level')) === levelMoved, 'after a reload Redo still goes forward', `${await trackAt('Vocal level')}`);
  await tap('Undo');
  await sleep(300);
  log((await trackAt('Vocal level')) === levelSet, 'and Undo back', `${await trackAt('Vocal level')}`);
  await expectText(/Polished\s/, 'the mix renders again', 30000);
  await shot('10-playback-tweak');

  // A second take, then punch in over it.
  // The mic in the bar is how another take is recorded from the song page.
  await tap('Freestyle over Night bus');
  await expectText('On the mic');
  // With a take made, the name is asked for once, here.
  await expectText('What do you go by?', 'after the first take the mic screen asks for a name');
  await type('Artist name', 'Kai Rivers');
  await tap('Save name');
  await sleep(300);
  log(!/What do you go by/.test(await text()), 'and does not ask again once it has one');
  // The kind of take is chosen right above the record button.
  log((await showing('New take')) && (await showing('Punch in')) && (await showing('Layer')), 'with a take made, the mic screen offers a new take, a punch-in or a layer');
  await tap('Punch in');
  await expectText('Punching in at bar 5', 'the recording screen says a punch-in is set');
  await shot('07c-take-mode');
  await tap('Start recording');
  await counted();
  await sleep(4500);
  await tap('Stop recording');
  await expectText('Take 2 saved', 'second take is saved in place', 10000);
  log(!(await showing('Done, hear it back')) && (await showing('Mix it')) && (await showing('Redo')), 'the saved take is a card with the way to the mix and a redo');
  await shot('08b-take-saved');
  // It plays right here, without leaving for the mix.
  await tap('Play take 2');
  let hearing = false;
  for (let i = 0; i < 40 && !hearing; i++) (hearing = await showing('Stop take 2')) || (await sleep(250));
  log(hearing && new URL(page.url()).pathname === '/vocals', 'the take plays on the mic screen');
  await tap('Stop take 2', { optional: true });
  await tap('Back to the loop');
  // Playing the loop only plays it, to hear the beat before a take.
  await tap('Play the loop');
  let looping = false;
  for (let i = 0; i < 20 && !looping; i++) (looping = await showing('Pause the loop')) || (await sleep(250));
  log(looping, 'the play button beside the waveform turns into pause while the loop plays');
  log(!/Always listening|Keep that/.test(await text()), 'playing the loop only plays it: nothing is held to keep');
  await tap('Pause the loop');
  // A third take, heard back in the mix straight from the recording screen.
  await tap('Start recording');
  await counted();
  await sleep(3500);
  // One stop. The take is saved and stays on this screen, in a card that plays it and leads to the mix.
  await tap('Stop recording');
  await expectText(/Take \d+ saved/, 'stopping saves the take and shows it on the mic screen', 10000);
  await tap('Mix it');
  await expectText('Take 3', 'the take opens in the mix', 10000);
  await expectText(/Take 3 · 0:0\d/, 'the mix is of the new take');
  await expectText(/Polished\s/, 'and it is polished', 30000);
  await tap('Pause', { optional: true });
  // The Song tab lists every take; tapping one picks it and plays it polished over the beat.
  await tap('Song');
  await expectText('3 takes', 'Song lists the takes');
  await expectText(/0:0\d · picked/, 'and marks the one that is picked');
  // Swiping a take shows Delete without deleting; tapping the row closes it again.
  log(!(await enabled('Delete take 2')), 'Delete is out of reach until a take is swiped');
  await swipeLeft('Take 2');
  log(await enabled('Delete take 2'), 'swiping a take shows Delete');
  log(/0:0\d · picked/.test(await text()), 'and does not also pick the take');
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
  // Layers: another take stacked on the picked one, with its own level and pan.
  await tap('Pause', { optional: true });
  await tap('Layer take 2');
  await expectText('Take 2 level', 'a take can be stacked on the picked one as a layer');
  await expectText(/Polishing take 1…/, 'adding a layer renders the song again', 8000);
  await expectText('Take 1, polished over the beat', 'and it finishes with the layer in', 30000);
  await tap('Ad-lib');
  log((await trackAt('Take 2 pan')) === 40, 'an ad-lib starts off to the right', `pan ${await trackAt('Take 2 pan')}`);
  // Best bars: one bar of the picked take played from another take.
  await tap('Bar 2, from take 1');
  log(await enabled('Bar 2, from take 2'), 'tapping a bar has it play from the next take');
  await expectText('Take 1, polished over the beat', 'and the song renders with that bar swapped', 30000);
  await shot('10c-layers');
  // Each tap moves the bar on to the next take that has it, and round to the picked take again.
  for (let i = 0; i < 4 && !(await enabled('Bar 2, from take 1')); i++) await tap(/^Bar 2, from take \d$/.test('') ? '' : (await page.evaluate(() => [...document.querySelectorAll('[role=button]')].map((n) => n.getAttribute('aria-label') ?? '').find((l) => l.startsWith('Bar 2, from take')) ?? 'Bar 2')));
  log(await enabled('Bar 2, from take 1'), 'tapping round again puts the bar back');
  await tap('Remove');
  await sleep(300);
  log(!/Take 2 level/.test(await text()), 'a layer can be removed again');
  // What was just done is offered back at the foot of the screen for a few seconds.
  await tap('Undo: Removed the layer of take 2');
  await expectText('Take 2 level', 'Undo, offered where the layer was removed, puts it back');
  await tap('Remove');
  await sleep(300);
  await expectText('Take 1, polished over the beat', 'and the song is as it was', 30000);
  // A deleted take can be brought back, and its audio comes with it.
  await swipeLeft('Take 3');
  await tap('Delete take 3');
  await expectText('2 takes', 'a take is deleted');
  await shot('10d-undo-delete');
  await tap('Undo: Deleted take 3');
  await expectText('3 takes', 'Undo brings a deleted take back');
  await tap('Take 3');
  await expectText('Take 3, polished over the beat', 'with its audio, which renders again', 30000);
  await tap('Redo');
  await expectText('2 takes', 'Redo deletes it again');
  await tap('Undo');
  await expectText('3 takes', 'and Undo on the song page steps back through edits');
  await tap('Take 1');
  await expectText('Take 1, polished over the beat', 'the first take is picked again', 30000);
  // Lyrics start as a button; tapping it opens the editor.
  log(!(await state(() => !!document.querySelector('textarea[aria-label=Lyrics]'))), 'with no lyrics yet there is a button, not an empty box');
  await tap('Add lyrics');
  await type('Lyrics', 'Night bus rolling, city on mute\nEvery red light is a breath I use');
  // Typing is undone a line at a time, not a letter at a time.
  const lyricsNow = () => state(() => [...document.querySelectorAll('textarea')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === 'Lyrics').pop()?.value ?? '');
  await tap('Undo typing');
  log((await lyricsNow()) === 'Night bus rolling, city on mute', 'Undo typing takes back the last line of lyrics', JSON.stringify(await lyricsNow()));
  await tap('Redo');
  log((await lyricsNow()) === 'Night bus rolling, city on mute\nEvery red light is a breath I use', 'and Redo puts it back', JSON.stringify(await lyricsNow()));
  // On a phone the lyrics now have a tab of their own, beside the takes.
  if (!WIDE) {
    log((await showing('Takes')) && (await showing('Lyrics')), 'on a phone the takes and the lyrics are two tabs');
    await tap('Takes');
    await expectText('Take 1, polished over the beat', 'and the takes are a tap away', 30000);
  }
  await tap('Pause', { optional: true });
  log(!(await showing('Repeat')) && !(await showing('8 bars')), 'the Song tab has no Repeat or bars either');
  await tap('Pause', { optional: true });
  log(!(await showing('Master the beat')), 'with takes on the song, the beat card is gone');
  log(!/Beat details/i.test(await text()), 'and so is the way into its details');
  await tap('Mix take', { exact: false });
  await expectText(/Polished\s/, 'the mix opens with those bars', 30000);
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

  // The chains are under Fine-tune: EQ, compressor, de-esser and limiter for vocal, beat and master.
  await openTune();
  await expectText('Starting from what Auto chose for this take', 'the song page shows the automatic chain', 15000);
  await shot('11-advanced');
  await slide('Gain', 0.9);
  await expectText('Set by hand', 'editing a band marks the chain as set by hand', 5000);
  // Adjustable controls say their value in real units, and move without a drag.
  let spoken = await valueText('Gain');
  log(/^[−+]?\d+\.\d dB$/.test(spoken), 'the gain slider reads out in dB', spoken);
  spoken = await valueText('Position in take');
  log(/^\d:\d\d of \d:\d\d$/.test(spoken), 'the seek bar reads out as a time', spoken);
  const point = await valueText('Curve point 2');
  await page.evaluate(() => [...document.querySelectorAll('[role=slider]')].find((n) => n.getAttribute('aria-label')?.startsWith('Curve point 2'))?.focus());
  await page.keyboard.press('ArrowDown');
  await sleep(400);
  spoken = await valueText('Curve point 2');
  log(/Hz, [−+]?\d+\.\d dB$/.test(spoken) && spoken !== point, 'an EQ point says where it is and moves from the keyboard', `${point} -> ${spoken}`);
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
  // While a slider is dragged, its value shows in a bubble above the thumb, where the finger does not hide it.
  const scrolled = await holdSlider('Intensity', 0, true);
  log(scrolled?.text === null, 'scrolling over a slider shows no value bubble');
  const bubble = await holdSlider('Intensity', 1, false, '12b-slider-bubble');
  log(bubble?.text === `${bubble?.now}%` && bubble.now === 100, 'dragging a slider shows its value in a bubble, in the words the row uses', `${bubble?.text}`);
  log(bubble?.left >= 0 && bubble.right <= bubble.width && bubble.bottom <= bubble.thumbTop, 'the bubble sits above the thumb and inside the screen', `${Math.round(bubble?.left)}–${Math.round(bubble?.right)} of ${bubble?.width}`);
  log(bubble?.gone === true, 'and goes when the finger lifts');
  await slide('Intensity', 1);
  await expectText('100%');
  await expectText(/Polished\s/, 'the mix renders with the master', 30000);
  await sleep(800);
  // A tab comes back where it was left. (The wide layout fits on one screen, so there is nothing to scroll.)
  if (!WIDE) {
    const scroller = () => [...document.querySelectorAll('div')].filter((n) => n.scrollHeight > n.clientHeight + 200 && getComputedStyle(n).overflowY !== 'visible' && n.getBoundingClientRect().width > 0 && n.innerText.includes('Fine-tune')).pop();
    await page.evaluate(`(${scroller})().scrollTop = 320`);
    await sleep(400);
    const before = await page.evaluate(`(() => { const n = (${scroller})(); return [n.scrollTop, n.scrollHeight, n.clientHeight].join('/'); })()`);
    await tap('Song');
    await expectText('Lyrics', 'Song opens from Mix');
    await tap('Mix');
    await expectText('Finish song', 'and Mix opens again');
    await sleep(1600);
    const top = await page.evaluate(`(${scroller})()?.scrollTop ?? -1`);
    log(Math.abs(top - 320) < 40, 'Mix is still scrolled to where it was left', `scrollTop ${top}, before ${before}, after ${await page.evaluate(`(() => { const n = (${scroller})(); return n ? [n.scrollTop, n.scrollHeight, n.clientHeight].join('/') : 'none'; })()`)}`);
  }
  await shot('13-mix-master');
  await closeTune();

  // Larger text. A browser has no Dynamic Type, so the app follows the browser's own font size:
  // turned up to the most the app allows, a slider's label and value move above its track,
  // which then has the whole width, and nothing spills off the side of the page.
  const sliderWidth = () => state(() => [...document.querySelectorAll('[role=slider]')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === 'Vocal level').pop()?.getBoundingClientRect().width ?? 0);
  const textSize = (px) => state(`document.documentElement.style.fontSize = '${px}'; window.dispatchEvent(new Event('resize'))`);
  const beside = await sliderWidth();
  await textSize('22.4px');
  await sleep(500);
  const above = await sliderWidth();
  log(above > beside + 80, 'with large text a slider row stacks its label and value above the track', `track ${Math.round(beside)} -> ${Math.round(above)} px wide`);
  log(await state(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'and the page does not spill sideways');
  await shot('13b-large-text');
  await textSize('');
  await sleep(300);
  log(Math.abs((await sliderWidth()) - beside) < 2, 'and goes back beside it at the usual size');
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
  // On a Home that already has beats, the ways to add one are behind this button.
  await tap('New beat', { optional: true });
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
  await shot('13b-song-transport');
  await tap('Mix take', { exact: false });
  await expectText(/Polished\s/, 'the mix opens from the song', 30000);
  await shot('13c-mix');
  await openTune();
  await expectText(/Reverb 60% · Echo off/i, 'the vocal reverb starts where the style puts it');
  await tap('Reverb and echo', { exact: false, optional: WIDE });
  await expectText('Room cut', 'reverb, echo and room cut are on the mix page');
  // The section eases open; a drag begun while it is still moving lands on the wrong thing.
  await sleep(600);
  await slide('Echo', 0.3);
  // The page can still be settling from the section opening when the drag starts; a drag that did not take is made again.
  if (!(await waitFor(/Echo (29|30|31)%/i, 1500))) await slide('Echo', 0.3);
  // The wide layout's sliders are shorter, so the same drag lands a step either side.
  await expectText(WIDE ? /Echo (29|30|31)%/i : /Echo 30%/i, 'echo can be added to the vocal');
  await expectText(/Polished\s/, 'and the mix renders with it', 30000);
  await tap('Reverb and echo', { exact: false, optional: WIDE });
  await tap('More for this mix');
  await tap('Send stems to an engineer');
  await expectText('stems.zip to your downloads', 'stems are saved from the song page', 30000);
  const stemZip = (await waitDownloads(1)).find((f) => f.endsWith('stems.zip'));
  const stemNames = stemZip ? unzipNames(path.join(DOWNLOADS, stemZip)) : [];
  log(stemNames.length === 3, 'the stems ZIP holds the beat and both vocals', stemNames.join(', '));
  // Finish song goes straight to naming it; there is no second mixing step in between.
  await tap('Finish song');
  await expectText('Save to the Vault', 'Finish song opens the last step directly');
  await expectText('A photo of the artist', 'the cover is one row, marked optional');
  // The wide layout has room for the cover beside the fields, so it keeps the full picture there.
  log(WIDE || (/optional/.test(await text()) && !/Add a photo of/.test(await text())), 'and does not read as something that must be added');
  log(await state(() => { const r = [...document.querySelectorAll('[role=button]')].filter((n) => n.getBoundingClientRect().width > 0 && n.innerText?.trim() === 'Save to the Vault').pop()?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= window.innerHeight; }), 'Save to the Vault is in view without scrolling');
  await type('Song title', 'Night bus');
  await type('Artist on this song', 'Mina Cole');
  await expectText('A photo of Mina Cole', 'the photo is asked for by the artist\'s name');
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
  await expectText('What is it for?', 'Share on a finished song opens on what it is for');
  log(!/Loudness|WAV, 24-bit/.test(await text()), 'with the loudness and format settings one step in');
  await expectText(/1 file · WAV 16-bit · loud, −9 LUFS/, 'a line under the button says what will be sent');
  log(await state(() => { const r = [...document.querySelectorAll('[role=button]')].filter((n) => n.getBoundingClientRect().width > 0 && /^(Save|Share) 1 file$/.test(n.innerText?.trim() ?? '')).pop()?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= window.innerHeight; }), 'and the button is in view without scrolling');
  await shot('14-export');
  await tap('Send to an engineer');
  await expectText(/3 files · WAV 24-bit · as mastered · instrumental and vocals/, 'a choice sets loudness, format and extras together');
  // Today's settings are still there, one row down.
  await tap('Custom loudness and format', { exact: false });
  await tap('Loud, for socials and demos');
  await tap('WAV, 16-bit');
  await expectText('Set by hand', 'settings changed by hand are said to be');
  await shot('14b-export-custom');
  // Chrome offers a share sheet, so saving is the second button; without one it is the only button.
  if (!(await tap('Save to Files', { optional: true }))) await tap('Save 3 files');
  await expectText('3 files saved to your downloads as Night bus.zip', 'export finishes', 60000);
  const files = await waitDownloads(2);
  const names = files.includes('Night bus.zip') ? unzipNames(path.join(DOWNLOADS, 'Night bus.zip')) : [];
  log(names.length === 3 && names.every((n) => n.endsWith('.wav')), 'the ZIP holds three WAV files', names.join(', ') || files.join(', '));
  // Then one file on its own, to check the audio itself.
  await tap('Post or upload');
  if (!(await tap('Save to Files', { optional: true }))) await tap('Save 1 file');
  await expectText('Saved Night bus.wav to your downloads', 'a single file is saved as it is', 60000);
  await waitDownloads(3);
  const header = fs.existsSync(path.join(DOWNLOADS, 'Night bus.wav')) ? fs.readFileSync(path.join(DOWNLOADS, 'Night bus.wav')) : null;
  log(!!header && header.toString('latin1', 0, 4) === 'RIFF' && header.readUInt16LE(34) === 16 && header.readUInt16LE(22) === 2, 'the song is a 16-bit stereo WAV', header ? `${header.length} bytes` : 'missing');
  // A listening link: the song goes up behind a private link, and a note left on its page comes back here.
  await tap('Listening link', { exact: false, optional: true });
  if (await tap('Make a listening link', { optional: true })) {
    await expectText('Update the link', 'a listening link is made for the song', 90000);
    const link = await state(() => [...document.querySelectorAll('input,textarea')].find((n) => n.getAttribute('aria-label') === 'Listening link')?.value ?? '');
    log(/\/s\/[a-z0-9]{20,}$/.test(link), 'the link ends in a long random token', link.replace(/[a-z0-9]{20,}$/, '<token>'));
    const listener = await browser.newPage();
    const response = await listener.goto(link, { waitUntil: 'domcontentloaded' });
    const pageText = await listener.evaluate(() => document.body.innerText);
    log(response.status() === 200 && /Night bus/.test(pageText) && /Leave a note/i.test(pageText), 'the link opens a player page with the song on it', `status ${response.status()}`);
    const playable = await listener.evaluate(() => new Promise((resolve) => { const a = document.getElementById('audio'); if (a.readyState >= 1) return resolve(a.duration); a.addEventListener('loadedmetadata', () => resolve(a.duration)); a.addEventListener('error', () => resolve(-1)); setTimeout(() => resolve(-2), 15000); }));
    log(playable > 3, 'the page can play the audio', `duration ${Number(playable).toFixed(2)} s`);
    await listener.evaluate(() => { document.getElementById('audio').currentTime = 3; });
    await sleep(400);
    await listener.type('input[name=name]', 'Sam <b>');
    await listener.type('textarea[name=text]', 'This bar <script>alert(1)</script> hits');
    await Promise.all([listener.waitForNavigation({ waitUntil: 'domcontentloaded' }), listener.click('button[type=submit]')]);
    const after = await listener.evaluate(() => ({ text: document.body.innerText, scripts: document.querySelectorAll('li script, li b:not([data-at])').length }));
    log(/0:03/.test(after.text) && /This bar <script>alert\(1\)<\/script> hits/.test(after.text) && after.scripts === 0, 'a note is pinned to its moment and shown as plain text', after.text.split('NOTES')[1]?.trim().slice(0, 80) ?? '');
    const gone = await listener.goto(link.replace(/[a-z0-9]{20,}$/, 'a'.repeat(36)), { waitUntil: 'domcontentloaded' });
    log(gone.status() === 404, 'a wrong token finds nothing', `status ${gone.status()}`);
    await listener.close();
    await page.bringToFront();
    await tap('Check for notes');
    await expectText('hits', 'the note comes back into the app on the song', 15000);
    await tap('Take it down');
    await expectText('Make a listening link', 'the link can be taken down', 15000);
    const again = await browser.newPage();
    const down = await again.goto(link, { waitUntil: 'domcontentloaded' });
    log(down.status() === 404, 'and then no longer opens', `status ${down.status()}`);
    await again.close();
    await page.bringToFront();
  }
  // Credits and splits: naming people adds a split sheet to what goes out.
  await tap('Credits and splits', { exact: false });
  await tap('Add credits');
  await expectText('Splits add up to 100%', 'credits start from the artist and producer, split evenly');
  await tap('Add a person');
  await type('Name 3', 'Jo Park');
  await type('Share 3, percent', '10');
  await expectText('Splits add up to 110%, not 100%', 'a split that does not add up is pointed out');
  await type('Share 2, percent', '40');
  await expectText('Splits add up to 100%', 'and fixed by changing a share');
  if (!(await tap('Save to Files', { optional: true }))) await tap('Save 2 files');
  await expectText('2 files saved to your downloads as Night bus.zip', 'the split sheet is saved with the song', 60000);
  await sleep(800);
  // Chrome numbers a second download of the same name, so the newest ZIP is the one to read.
  const newestZip = fs.readdirSync(DOWNLOADS).filter((f) => /^Night bus.*\.zip$/.test(f) && !/stems/.test(f)).map((f) => path.join(DOWNLOADS, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const sheetNames = newestZip ? unzipNames(newestZip) : [];
  log(sheetNames.includes('Night bus split sheet.txt'), 'the ZIP holds the split sheet', sheetNames.join(', '));
  for (let i = 0; i < 3; i++) await tap('Remove');
  await expectText('Add credits', 'credits can be taken off again');
  // The small format for sending, where the browser can make it. ffprobe reads it as a real M4A.
  if (await tap('M4A, for sending', { optional: true })) {
    if (!(await tap('Save to Files', { optional: true }))) await tap('Save 1 file');
    await expectText('Saved Night bus.m4a to your downloads', 'the song is saved as an M4A', 60000);
    await waitDownloads(4);
    const small = path.join(DOWNLOADS, 'Night bus.m4a');
    const probe = fs.existsSync(small) ? spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels,sample_rate:format=duration', '-of', 'json', small], { encoding: 'utf8' }) : null;
    if (probe && probe.error) log(true, 'ffprobe is not installed, so the M4A was not inspected');
    else {
      const info = probe ? JSON.parse(probe.stdout || '{}') : {};
      const stream = info.streams?.[0] ?? {};
      const seconds = Number(info.format?.duration ?? 0);
      log(stream.codec_name === 'aac' && stream.channels === 2 && seconds > 3, 'the M4A is stereo AAC of the right length', `${stream.codec_name} ${stream.channels}ch ${stream.sample_rate} Hz ${seconds.toFixed(2)} s, ${fs.existsSync(small) ? fs.statSync(small).size : 0} bytes`);
      log(fs.statSync(small).size < header.length / 3, 'and is much smaller than the WAV', `${fs.statSync(small).size} vs ${header.length} bytes`);
    }
    await tap('WAV, 16-bit');
  }
  // Share is a sheet over the player: it has the one close button every sheet has, and Escape closes it too.
  log(await state(() => !!document.querySelector('[role=dialog]')), 'Share opens as a sheet over the player');
  await tap('Close');
  await expectText('Prod. Lowkey', 'closing the sheet returns to the player');
  await tap('Share');
  await expectText('What is it for?', 'the sheet opens again');
  await page.keyboard.press('Escape');
  await expectText('Prod. Lowkey', 'and Escape closes it');
  // The wide player always shows the lyrics; the phone keeps them behind a button.
  await tap('Lyrics', { optional: WIDE });
  await expectText('Every red light is a breath I use', 'the lyrics written on the song came with it');
  await tap('Hide lyrics', { optional: WIDE });
  await tap('Pause', { optional: true });

  await tap('Snippet');
  await expectText('Strongest stretch picked', 'snippet finds its stretch', 30000);
  // The stretch can be moved along the song, and put back.
  if (await state(() => !![...document.querySelectorAll('[role=slider]')].find((n) => n.getAttribute('aria-label') === 'Snippet position'))) {
    await tapTrack('Snippet position', 0.2);
    await expectText('Your pick', 'the snippet can be moved to another part of the song', 5000);
    const stretch = await valueText('Snippet position');
    log(/^\d:\d\d to \d:\d\d$/.test(stretch), 'the snippet window reads out as the stretch it covers', stretch);
    await tap('Strongest stretch');
    await expectText('Strongest stretch picked', 'and put back on the strongest stretch', 5000);
  }
  // With lyrics on the song, the words on the video are its lines, each timed to where the voice is.
  await expectText('Line timing', 'a song with lyrics shows them in time on its snippet');
  const lineLabels = () => state(() => [...document.querySelectorAll('[role=button]')].filter((n) => n.getBoundingClientRect().width > 0).map((n) => n.getAttribute('aria-label') ?? '').filter((l) => l.startsWith('Play from line ')));
  let timedLines = [];
  for (let i = 0; i < 40 && !timedLines.length; i++) (timedLines = await lineLabels()).length || (await sleep(250));
  const startOf = (label) => Number(/at ([\d.]+) s/.exec(label ?? '')?.[1] ?? NaN);
  log(timedLines.length >= 1 && timedLines.every((l, i) => i === 0 || startOf(l) > startOf(timedLines[i - 1])), 'the lyric lines in this stretch are listed in order, each with when it shows', timedLines.join(' | '));
  const onCard = await state(() => document.querySelector('[data-testid=snippet-line]')?.innerText.trim() ?? '');
  log(['Night bus rolling, city on mute', 'Every red light is a breath I use'].includes(onCard), 'and the card shows a lyric line where the caption was', onCard);
  // A line that comes in early or late is moved a quarter of a second at a time, and put back.
  const lineNo = /line (\d+)/.exec(timedLines[timedLines.length - 1] ?? '')?.[1] ?? '1';
  const wasAt = startOf(timedLines[timedLines.length - 1]);
  await tap(`Line ${lineNo} earlier`);
  let nowAt = startOf((await lineLabels()).pop());
  log(Math.abs(wasAt - nowAt - 0.25) < 0.011 || nowAt < wasAt, 'a line can be nudged earlier', `${wasAt} s -> ${nowAt} s`);
  await tap('Reset timing');
  nowAt = startOf((await lineLabels()).pop());
  log(nowAt === wasAt, 'and Reset timing puts it back', `${nowAt} s`);
  await shot('21-snippet');
  // The snippet is made first; saving or sharing it is then one more tap.
  await tap('Make snippet');
  await expectText('Snippet ready', 'the snippet video is made', 60000);
  // The buttons stay off for a moment after the snippet is made, while that work winds up.
  await sleep(500);
  await tap('Save snippet');
  await expectText(/Saved Night bus snippet\.(mp4|webm) to your downloads/i, 'snippet video is recorded', 60000);
  // One caption line is still there for the asking, written on the card itself.
  await tap('One line');
  log((await state(() => [...document.querySelectorAll('textarea')].filter((n) => n.getBoundingClientRect().width > 0 && n.getAttribute('aria-label') === 'Caption line').pop()?.value ?? '')) === 'Night bus rolling, city on mute', 'the caption on the card starts as the first lyric line, and is edited there');
  log(!/Line timing/.test(await text()), 'and the line timing is put away with it');
  const video = (await waitDownloads(4)).find((f) => /snippet\.(mp4|webm)$/.test(f));
  log(!!video && fs.statSync(path.join(DOWNLOADS, video)).size > 20000, 'snippet video file was written', video ? `${video}, ${fs.statSync(path.join(DOWNLOADS, video)).size} bytes` : 'missing');
  // The same snippet in the square shape for feeds: picking a shape asks for it to be made again.
  if (await tap('Square 1:1', { optional: true })) {
    await tap('Make snippet');
    await expectText('Snippet ready', 'the square snippet is made', 60000);
    await sleep(500);
    await tap('Save snippet');
    await expectText(/Saved Night bus snippet \(square\)\.(mp4|webm) to your downloads/i, 'and saved under its own name', 60000);
    await sleep(1500);
    const square = fs.readdirSync(DOWNLOADS).find((f) => /snippet \(square\)\.(mp4|webm)$/.test(f));
    const probe = square ? spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(DOWNLOADS, square)], { encoding: 'utf8' }) : null;
    if (probe && !probe.error) log(probe.stdout.trim() === '1080,1080', 'the square snippet is 1080 by 1080', probe.stdout.trim() || 'unreadable');
    await tap('Tall 9:16');
  }
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
    await tap('Close');
    await expectText(IN_VAULT, 'and closing it returns to the Vault', 15000);
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
  // On a wide screen the Vault shows around the player's card, so its text is there before the card has gone.
  log(await page.waitForFunction(() => location.pathname !== '/player', { timeout: 5000 }).then(() => true, () => false), 'and the player itself is gone');
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
  await expectText('On the mic', 'a finished song leads back to its beat', 10000);
  await sleep(800);
  await tap('Start recording');
  await counted();
  await sleep(3000);
  await tap('Stop recording');
  await expectText('Take 4 saved', 'another take is recorded over it', 10000);
  await tap('Home');
  await expectText('PICK UP WHERE YOU LEFT OFF', 'and the beat is back on Home');
  await expectText('In the Vault · new takes', 'where it says there are takes newer than its finished song');
  log((await showing('Record over Night bus')) && (await showing('Open song Night bus')), 'with a button for the mic and one for the song');
  await shot('23-home');
  // With a beat to carry on with, adding another is one button that opens the three ways in.
  log((await showing('New beat')) && !(await showing('Add a demo song')), 'home offers a new beat under the ones in progress');
  await tap('New beat');
  await tap('Add a demo song');
  await expectText('Ready-made beats', 'and leads into the demo songs');
  // The demo songs are a sheet over Home, with no tabs around it; closing it shows Home again.
  log(await state(() => !!document.querySelector('[role=dialog]') && ![...document.querySelectorAll('[role=tab]')].some((n) => n.getBoundingClientRect().width > 0)), 'as a sheet, with the tab bar out of the way');
  await tap('Close');
  await sleep(500);
  log(await state(() => !document.querySelector('[role=dialog]')), 'closing the sheet puts it away');
  await expectText('New beat');
  await tap('Open Night bus');
  await expectText('Mix take', 'a beat opens its song', 10000);
  log(!/Beat details/i.test(await text()), 'with takes on the song, the beat details are not shown');
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
  log(/RECORDING/i.test(await text()) && /THIS DEVICE/i.test(await text()) && !/not built yet/.test(await text()), 'Settings is three groups of rows, without the stale line about restoring');
  await openRow('Move to another device');
  // The restore code for this device is shown on request. Backup is then switched off, so the beats
  // deleted later in this run stay on the server to be restored at the end.
  await tap("Show this device's restore code");
  restoreCode = await state(() => [...document.querySelectorAll('input,textarea')].find((n) => n.getAttribute('aria-label') === 'Restore code')?.value ?? '');
  log(/^[a-z0-9]{16,}\.[0-9a-f]{64}$/.test(restoreCode), 'Settings shows a restore code for this device');
  await tap('Hide the code');
  await tap('Back up my beats and takes');

  // The microphone and its timing are set here in Settings, with the guided setup one tap away.
  await openRow('Timing');
  log((await showing('Check it')) && !(await showing('Play the clicks')), 'with no microphone, timing offers one button that connects it first');
  await openRow('Microphone');
  await tap('Connect a microphone');
  await expectText(/kHz · (mono|stereo)/, 'the microphone connects from its row', 10000);
  await openRow('Timing');
  await expectText('Play the clicks', 'Settings holds the microphone and timing', 10000);
  await shot('24a-mic-setup');
  await tap('Walk me through the setup again');
  await expectText('Sound check', 'the guided setup opens from Settings');
  await tap('Connect an input', { optional: true });
  await expectText('Connected', 'input connects in setup');
  await tap('Continue');
  await expectText('Line up your takes');
  await shot('24b-setup-timing');
  (await tap('Done', { optional: true })) || (await tap('Use the estimate'));
  await expectText('Move to another device', 'setup returns to Settings');
  await tap('Freestyle over Night bus');
  await expectText('Tap to record', 'the mic screen opens', 10000);
  // On a phone the mic screen has the lyrics on a tab, with a record button under them.
  if (!WIDE) {
    await tap('Lyrics');
    await expectText('Every red light is a breath I use', 'on a phone the mic screen has the lyrics on a tab');
    log(await showing('Start recording'), 'with a record button under them');
    await shot('24-mic-lyrics');
    await tap('Record');
  }
  // On the mic no longer holds the microphone or a count-in switch: it points at Settings, and every take counts in.
  await openSetup();
  await expectText('Set once for this device, in Settings', 'On the mic points to Settings for the microphone');
  log(!/clicks before recording starts/.test(await text()), 'and has no count-in switch: every take counts in');
  await closeSetup();
  await tap('Home');

  // Everything survives a reload.
  await page.reload({ waitUntil: 'networkidle2' });
  await expectText('PICK UP WHERE YOU LEFT OFF', 'the library is still there after a reload', 30000);
  await expectText('Night bus');

  // Capture a beat from the input (the test tone stands in for a sampler).
  await tap('New beat', { optional: true });
  await tap('Capture from your gear');
  await tap('Connect', { optional: true });
  await expectText('Connected', 'capture screen connects', 10000);
  await tap('Arm recording');
  await expectText('Recording', 'recording starts at the first sound', 8000);
  await sleep(4500);
  await shot('25-record');
  // The same goes for a beat being captured.
  await page.goBack().catch(() => {});
  await sleep(600);
  log(new URL(page.url()).pathname === '/record' && /Recording/i.test(await text()), 'Back does not leave a capture that is running', page.url());
  await tap('Stop recording');
  await expectText('Nothing recorded over this beat yet', 'a captured beat opens on its Song page', 20000);
  await tap('Song');
  await expectText('Not in the Vault yet', 'and its song is on the Song tab');
  // Its details, where it is named and mastered alone, open in place.
  await tap('Beat details', { exact: false });
  await expectText('Beat captured', 'captured beat is saved', 10000);
  await expectText('Master the beat', 'its details open inside the Song tab');
  await shot('26-captured');
  // Master it as an instrumental.
  await tap('Master the beat', { exact: false });
  // The beat alone is mixed on the Mix page, with the navigation still there and none of the vocal's controls.
  await expectText('Beat only', 'mastering the beat opens the Mix page', 30000);
  await expectText(/Mastered\s/, 'an instrumental can be mastered on its own', 30000);
  log((await showing('Master')) && (await showing('Beat')) && !(await showing('Vocal')), 'with the Beat and Master chains, and no Vocal one');
  log(!(await showing('Upfront')) && !/Vocal level|Double track/.test(await text()), 'and none of the vocal controls');
  log((await showing('Finish song')) && (await showing('Home', 'tab')) && (await showing('Vault', 'tab')), 'the navigation stays at the bottom, and the song can be finished from here');
  await shot('26b-beat-on-mix');
  await tap('Pause', { optional: true });
  await tap('Song');
  await expectText('Not in the Vault yet', 'the Song tab leads back to its song');
  if (!(await tap('Delete this beat', { optional: true, exact: false }))) {
    await tap('Beat details', { exact: false });
    await tap('Delete this beat', { exact: false });
  }
  await expectText('PICK UP WHERE YOU LEFT OFF', 'deleting a beat returns home', 10000);
  await expectText(/\S deleted\s+Undo/, 'and says so, with a way to take it back');
  log(!(await showing('Open Untitled beat')), 'the deleted beat is gone from the list');

  // Import one of the exported files as a new beat.
  await choose('Import a file', path.join(DOWNLOADS, 'Night bus.wav'));
  await expectText('Nothing recorded over this beat yet', 'an imported file opens on its Song page', 30000);
  await tap('Song');
  await expectText('Not in the Vault yet', 'and its song is on the Song tab');
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
  await expectText('Nothing recorded over this beat yet', 'a 48 kHz file is imported', 30000);
  await tap('Song');
  await expectText('100 BPM', 'its tempo is found');
  await tap('Beat details', { exact: false });
  await expectText('48 kHz');
  // The top bar names the song these screens are showing, and switches to another without leaving the screen.
  log(await showing('Switch song, now Basement tape'), 'the top bar names the song being worked on');
  await tap('Switch song, now Basement tape');
  await expectText('Working on', 'tapping it lists the beats in progress');
  await shot('27b-song-switcher');
  await tap('Work on Night bus');
  await sleep(500);
  log(new URL(page.url()).pathname === '/song' && (await showing('Switch song, now Night bus')) && (await showing('Rename Night bus')), 'picking one shows that song on the same screen');
  await tap('Mix');
  await sleep(500);
  log(await showing('Switch song, now Night bus'), 'and Mix follows it');
  await tap('Switch song, now Night bus');
  await tap('Work on Basement tape');
  await sleep(500);
  log(new URL(page.url()).pathname === '/playback' && (await showing('Switch song, now Basement tape')), 'switching on Mix stays on Mix');
  await tap('Switch song, now Basement tape');
  await tap('All beats');
  await expectText('Your beats', 'and All beats leads to Home');
  log(await showing('Bounce: home', 'link'), 'where the logo is back');
  await tap('Freestyle over Basement tape');
  await expectText('On the mic', 'the mic screen opens for the new beat', 10000);
  await tap('8 bars');
  await tap('Start recording');
  await expectText(/Bar \d+ · pass 1/, 'recording runs at the beat\'s rate', 12000);
  await sleep(3500);
  // One stop. The take is saved and stays on this screen, in a card that plays it and leads to the mix.
  await tap('Stop recording');
  await expectText(/Take \d+ saved/, 'stopping saves the take and shows it on the mic screen', 10000);
  await tap('Mix it');
  await expectText('Take 1', 'the take opens in playback', 10000);
  await expectText(/Polished\s/, 'and is polished', 30000);
  log(await transportPlaying(), 'and plays');
  await shot('28-playback-48k');

  // Artists: picking who is on the mic starts a session, and a song that is no one's becomes theirs.
  await tap('Freestyle over Basement tape');
  await openSetup();
  await expectText('On the mic: no one picked', 'the mic screen says no one has been picked yet', 10000);
  await tap('Pick');
  await type('New artist name', 'Jay Oh');
  await tap('Add');
  await expectText('On the mic: Jay Oh', 'an artist is added and picked for the session');
  await shot('28b-on-the-mic');
  // Their vocal sound is saved from the Mix page, next to the preset.
  await tap('Mix');
  await expectText(/Polished\s/, 'the mix opens', 30000);
  await tap('Pause', { optional: true });
  await tap('Save for Jay Oh');
  await expectText('Saved for Jay Oh', 'the vocal chain is saved for the artist on the song');
  await expectText("Use Jay Oh's sound", 'and can be put on a song of theirs again');
  // The artist view: the mic screen for the person at the mic, with the navigation put away.
  await tap('Freestyle over Basement tape');
  await expectText('On the mic');
  await openSetup();
  await tap('Open artist view');
  await expectText('Exit artist view', 'the artist view opens');
  await expectText('Tap to record', 'with one large record button');
  log(await state(() => ![...document.querySelectorAll('[role=tab]')].some((n) => n.getBoundingClientRect().width > 0)), 'and no navigation around it');
  const big = await state(() => { const r = [...document.querySelectorAll('[role=button]')].filter((n) => n.getBoundingClientRect().width > 0).find((n) => n.getAttribute('aria-label') === 'Start recording')?.getBoundingClientRect(); return r ? Math.min(r.width, r.height) : 0; });
  log(big >= 140, 'the record button is large enough to hit from a step away', `${Math.round(big)} points`);
  await shot('28c-artist-view');
  await tap('Start recording');
  await expectText('Tap to stop', 'recording starts from the artist view', 12000);
  await sleep(1200);
  await shot('28d-artist-view-recording');
  await sleep(2500);
  await tap('Stop recording');
  await expectText('Take 2 saved', 'the take is saved and the artist view stays up', 10000);
  await expectText('Exit artist view');
  // A take can be done again: the new one takes its place instead of adding to the list.
  await tap('Redo take 2');
  await counted();
  await sleep(2500);
  await tap('Stop recording');
  await expectText('in place of take 2', 'redoing a take saves the new one in its place', 10000);
  await tap('Hear the last take');
  let heard = false;
  for (let i = 0; i < 60 && !heard; i++) (heard = /Stop playing/.test(await text())) || (await sleep(500));
  log(heard, 'the take can be heard back from the artist view');
  await tap('Stop playing', { optional: true });
  await tap('Exit artist view');
  await expectText('On the mic', 'leaving it returns to the full mic screen');
  await tap('Song');
  await expectText('2 takes', 'the take recorded in the artist view is on the song');
  await swipeLeft('Take 3');
  await tap('Delete take 3');
  await expectText('1 take', 'and can be deleted like any other');
  // The artist has a profile, with their songs and their sound on it.
  await page.goto(BASE + '/profile', { waitUntil: 'networkidle2' });
  await expectText('Artists you record', 'Profile lists the artists recorded here', 20000);
  await expectText(/1 song · Vocal sound saved/, 'with their songs and the vocal sound saved for them');
  await shot('28e-artists');
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await expectText('Basement tape', 'Home opens again', 20000);
  await tap('Open Basement tape');
  await expectText('1 take', 'and the song is as it was left', 20000);

  // Swipe to delete: a take from the song, then the beat from Home.
  await tap('Song');
  await expectText('1 take', 'Song shows the new take');
  await swipeLeft('Take 1');
  await tap('Delete take 1');
  await expectText('No takes yet', 'one tap on Delete removes a take, since it can be undone', 10000);
  await tap('Home');
  await expectText('New beat', 'Home opens');
  await sleep(600); // let the screen change settle before dragging on it
  await swipeLeft('Open Basement tape');
  await shot('29-swipe-beat');
  // Deleting is one tap, and can be taken back for a few seconds where it happened.
  await tap('Delete Basement tape', { exact: false });
  await expectText('Basement tape deleted', 'swiping and tapping Delete removes a beat at once and says so');
  log(!(await showing('Open Basement tape')), 'and it is gone from the list');
  await tap('Undo: Basement tape deleted');
  await sleep(500);
  log(await showing('Open Basement tape'), 'Undo brings the beat back');
  // The same delete is in each row's menu, in red, for anyone who never finds the swipe.
  await tap('More for Basement tape');
  await shot('29b-beat-menu');
  await tap('Delete');
  await sleep(600);
  log(!(await showing('Open Basement tape')), 'and the menu deletes it too');
  await expectText('Night bus', 'and leaves the others');

  // With no beat left, Song, the mic and Mix stay on their own screens and offer to add one.
  for (let i = 0; i < 6; i++) {
    const left = await page.evaluate(() => [...document.querySelectorAll('[role=button]')].map((n) => n.getAttribute('aria-label') ?? '').filter((l) => l.startsWith('Open ') && !l.startsWith('Open song ')).map((l) => l.slice(5)));
    if (!left.length) break;
    await swipeLeft(`Open ${left[0]}`);
    await tap(`Delete ${left[0]}`, { exact: false });
    await sleep(600);
  }
  await expectText('Bring a beat', 'home is empty once every beat is deleted');
  await shot('29-home-empty');
  await tap('Song');
  await expectText('No song yet', 'Song stays put and says why it is empty');
  await expectText('Add a beat', 'and offers the ways to add a beat');
  await shot('30-no-song');
  await tap('Mix');
  await expectText('Nothing to mix yet', 'Mix does the same');
  await tap('Add a beat to freestyle');
  await expectText('Nothing to record over yet', 'and so does the mic');
  // With nothing to record over, the mic is a tab like the others: a tap on it while its screen is open changes nothing.
  await tap('Add a beat to freestyle');
  await sleep(400);
  log(new URL(page.url()).pathname === '/vocals' && /Nothing to record over yet/.test(await text()), 'tapping the mic again on its own screen stays there');
  await tap('Try a demo song');
  await expectText('Ready-made beats', 'its tiles lead on, here to the demo songs');

  // Restore: the beats deleted above come back from the backup, with their audio, from the code alone.
  if (restoreCode) {
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle2' });
    await expectText('Move to another device', 'Settings opens', 20000);
    await openRow('Move to another device');
    await type('Restore code from another device', restoreCode);
    await tap('Restore from this code');
    await expectText(/\d+ songs? restored/, 'a backup is restored from its code', 60000);
    await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
    await expectText('Night bus', 'the restored beat is back on Home', 20000);
    await tap('Open Night bus');
    await expectText('4 takes', 'with its takes', 20000);
    await expectText(/Take \d, polished over the beat/, 'and its audio, which renders and plays', 40000);
  }
}

// ---------- Server settings, for the backup limits ----------

// The backup limits are server settings. They can only be changed here when the app is talking to
// the local server that `npx convex` in this folder manages (LIMITS=0 leaves them alone regardless).
const cliServer = /^EXPO_PUBLIC_CONVEX_URL=(.+)$/m.exec(fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '')?.[1]?.trim().replace(/\/$/, '');
const LIMIT_NAMES = ['BACKUP_MAX_MB', 'BACKUP_MAX_FILE_MB'];
const convexCli = (...args) => spawnSync('npx', ['convex', 'env', ...args], { encoding: 'utf8' });
/** What the limits were before this run, so they can be put back; null until they have been touched. */
let limitsBefore = null;
function canLimit() {
  if (process.env.LIMITS === '0' || !serverOrigin || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(serverOrigin) || cliServer !== serverOrigin) return false;
  if (limitsBefore) return true;
  const before = {};
  for (const name of LIMIT_NAMES) {
    const got = convexCli('get', name);
    if (got.status !== 0) return false;
    before[name] = /not found/.test(got.stdout + got.stderr) ? undefined : got.stdout.trim() || undefined;
  }
  limitsBefore = before;
  return true;
}
/** Sets the backup limits in megabytes; a limit left out goes back to the server's default. */
function setLimits({ total, file } = {}) {
  const want = { BACKUP_MAX_MB: total, BACKUP_MAX_FILE_MB: file };
  for (const name of LIMIT_NAMES) {
    const done = want[name] === undefined ? convexCli('remove', name) : convexCli('set', name, String(want[name]));
    if (done.status !== 0 && want[name] !== undefined) throw new Error(`could not set ${name} on the server: ${(done.stderr || done.stdout).trim().slice(0, 200)}`);
  }
}
/** Puts the limits back as they were found. Safe to call more than once. */
function restoreLimits() {
  if (!limitsBefore) return;
  for (const name of LIMIT_NAMES) limitsBefore[name] === undefined ? convexCli('remove', name) : convexCli('set', name, limitsBefore[name]);
  limitsBefore = null;
}
process.on('SIGINT', () => (restoreLimits(), process.exit(130)));

/** Starts a take from the mic in the bar, lets it run for a while past the count-in, and stops it. */
async function recordTake(during) {
  await tap('Start recording');
  // A layer renders the mix it plays over first, so the take can be a moment in starting.
  for (let i = 0; i < 160 && !(await shows('Stop recording')); i++) await sleep(250);
  // The count-in shows the beat it is on; the take itself starts when that goes.
  await sleep(300);
  for (let i = 0; i < 60 && /count-in · \d/i.test(await text()); i++) await sleep(150);
  await during?.();
  await sleep(3500);
  await tap('Stop recording');
}
const openSettings = async () => {
  await tap('Home');
  await tap('Your menu');
  await tap('Settings');
  await expectText('Storage', 'Settings opens');
};

/** What happens when things go wrong: storage that cannot be read or written, a backup with no room, a server that is away. */
async function failures() {
  // ----- A change made in the last moment before the page goes away -----
  // Changes are saved a quarter of a second after they are made, so this one is still waiting when the page reloads.
  await tap('Song');
  await expectText('Lyrics', 'Song opens');
  await sleep(1000);
  await tap('Add lyrics', { optional: true });
  await tap('Lyrics', { optional: true });
  await type('Lyrics', 'Saved in the last moment');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(600);
  const lastSaved = JSON.parse(await stored('library')).projects.some((p) => p.lyrics === 'Saved in the last moment');
  log(lastSaved, 'a change made just before a reload is still saved', lastSaved ? '' : 'the lyrics typed just before it are not in the saved library');

  // ----- A library that will not open -----
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 120000 });
  await expectText('New beat', 'Home opens with the library', 30000);
  await sleep(600);
  const savedLibrary = await stored('library');
  await setFault('read');
  await page.reload({ waitUntil: 'networkidle2' });
  await expectText('Your songs could not be opened', 'a library that cannot be read gets a screen that says so', 30000);
  await expectText('Nothing has been changed or lost');
  await expectText('Storage was made to fail for this test', 'with what storage reported');
  log(!(await shows('Home')) && !/Add a beat|New beat/i.test(await text()), 'and the app does not start on an empty library behind it');
  await shot('31-library-unreadable');
  await tap('Try again');
  await sleep(1500);
  log(/Your songs could not be opened/.test(await text()), 'trying again while storage still fails stays on that screen');
  log((await stored('library')) === savedLibrary, 'nothing is written over the saved library while it shows');
  await setFault(null);
  await tap('Try again');
  await expectText('New beat', 'trying again once storage answers opens the library', 30000);
  await expectText('Night bus', 'with the songs that were saved');

  // ----- The backup, switched on for what follows -----
  await openSettings();
  const hasBackup = !/No backup server is configured/.test(await text());
  if (hasBackup) {
    if (/Off\. Everything stays only on this device/.test(await text())) await tap('Back up my beats and takes');
    await expectText('Everything is backed up', 'the backup is up to date before anything goes wrong', 90000);
  }
  const limits = hasBackup && canLimit();
  if (hasBackup && !limits) console.log(`skip the backup-full and file-too-big messages: they need the local server this folder's .env.local points at (app uses ${serverOrigin}, .env.local has ${cliServer ?? 'none'}), and Node 22.13 or newer for the Convex command line`);
  // From here no file over 1 MB is taken, so the beat added next stays out of the backup.
  if (limits) setLimits({ file: 1 });

  // ----- A take that cannot be stored -----
  await page.goto(BASE + '/demos', { waitUntil: 'networkidle2', timeout: 120000 });
  await expectText('Ready-made beats', 'the demo songs open');
  await tap('Built in', { optional: true });
  await tap('Add Night bus');
  await expectText('Nothing recorded over this beat yet', 'a fresh beat is added to record over', 20000);
  await sleep(600);
  // A second copy of a demo gets a number after its name.
  const beatName = await page.evaluate((saved) => saved.projects.find((p) => p.id === saved.currentId)?.name ?? '', JSON.parse(await stored('library')));
  log(/^Night bus( \d+)?$/.test(beatName), 'and is the beat that is open', beatName);
  const mic = `Freestyle over ${beatName}`;
  await tap(mic);
  await expectText('On the mic', 'the mic screen opens', 10000);
  await tap('8 bars');
  log(!(await asksBeforeLeaving()), 'with nothing being recorded, the tab can be closed without being asked');

  await setFault('write');
  await recordTake(async () => log(await asksBeforeLeaving(), 'while a take is being recorded, closing or reloading the tab asks first'));
  await expectText('That take could not be saved', 'a take that cannot be stored says so', 15000);
  await expectText('It is still here');
  log((await shows('Try again')) && (await shows('Save as a file')) && (await shows('Discard')), 'and offers to try again, save it as a file, or discard it');
  log(await asksBeforeLeaving(), 'with a take waiting to be saved, leaving still asks first');
  await shot('32-take-unsaved');
  // Recording again would replace the take in hand, so the mic waits.
  await tap('Start recording', { optional: true });
  await sleep(1200);
  log(!(await shows('Stop recording')) && (await shows('Try again')), 'the mic does not start another take over it');
  await tap('Try again');
  await sleep(1500);
  log((await shows('Try again')) && /That take could not be saved/.test(await text()), 'trying again while storage still fails keeps the take in hand');
  await setFault(null);
  await tap('Try again');
  await expectText('Take 1 saved', 'trying again once storage works saves the take, which stays on the mic screen', 15000);
  await tap('Mix it');
  await expectText(/Take 1 · 0:0\d/, 'one tap from the mix', 15000);
  await expectText(/Polished\s/, 'where it plays back polished', 30000);
  log(!(await asksBeforeLeaving()), 'once it is saved, the tab can be closed again');
  await tap('Pause', { optional: true });

  // The same failure, answered by saving the take as a file.
  await tap(mic);
  await expectText('On the mic');
  await setFault('write');
  await recordTake();
  await expectText('That take could not be saved', 'a second take fails the same way', 15000);
  let had = downloads().length;
  await tap('Save as a file');
  await expectText(`Saved to your downloads as ${beatName} take.wav. It is not in this song.`, 'a take that cannot be stored can be saved as a file', 20000);
  await waitDownloads(had + 1);
  const takeFile = fs.existsSync(path.join(DOWNLOADS, `${beatName} take.wav`)) ? fs.readFileSync(path.join(DOWNLOADS, `${beatName} take.wav`)) : null;
  log(!!takeFile && takeFile.toString('latin1', 0, 4) === 'RIFF' && takeFile.readUInt16LE(22) === 1 && takeFile.readUInt16LE(34) === 24 && takeFile.length > 100000, 'the file is the take, as a 24-bit mono WAV', takeFile ? `${takeFile.length} bytes` : 'missing');
  log(!(await shows('Try again')) && !(await asksBeforeLeaving()), 'and then nothing is left waiting');

  // And answered by discarding it, which takes a second tap.
  await recordTake();
  await expectText('That take could not be saved', 'a third take fails the same way', 15000);
  await tap('Discard');
  log((await shows('Tap again to discard')) && (await shows('Try again')), 'Discard asks for a second tap first');
  await tap('Tap again to discard');
  await sleep(400);
  log(!(await shows('Try again')) && !/could not be saved|waiting to be saved/.test(await text()), 'the second tap discards the take');
  log(!(await asksBeforeLeaving()), 'and the tab can be closed again');
  await setFault(null);
  await tap('Song');
  await expectText('1 take', 'only the take that was saved is in the song');
  log(!/2 takes/.test(await text()), 'the two that were not saved are not');

  // ----- A take recorded as a layer -----
  await tap(mic);
  await expectText('On the mic');
  await tap('Layer');
  await expectText('As a layer on take 1', 'the mic screen says the take will be a layer');
  await recordTake();
  await expectText('Take 2 level', 'a take recorded as a layer opens Song, under Layers', 20000);
  await expectText('2 takes');
  log((await trackAt('Take 2 pan')) === 40 && (await trackAt('Take 2 level')) === 50, 'as an ad-lib, off to the right', `level ${await trackAt('Take 2 level')}, pan ${await trackAt('Take 2 pan')}`);
  log(!(await shows('Layer take 2')), 'so it is not offered as a layer a second time');
  await sleep(600);
  const layeredSong = JSON.parse(await stored('library')).projects.find((p) => p.takes.length === 2 && p.layers?.length === 1);
  log(!!layeredSong && layeredSong.takeId === layeredSong.takes[0].id && layeredSong.layers[0].takeId === layeredSong.takes[1].id && layeredSong.layers[0].role === 'adlib', 'take 1 is still the picked take, with take 2 saved on it as an ad-lib layer');
  await expectText('Take 1, polished over the beat', 'and the song renders with the layer in', 40000);
  await shot('33-layer-recorded');
  await tap('Pause', { optional: true });

  // ----- A captured beat that cannot be stored -----
  await tap('Home');
  await tap('New beat', { optional: true });
  await tap('Capture from your gear');
  await tap('Connect', { optional: true });
  await expectText('Connected', 'the capture screen connects', 10000);
  await setFault('write');
  await tap('Arm recording');
  await expectText('Recording', 'a capture starts at the first sound', 8000);
  log(await asksBeforeLeaving(), 'while a beat is being captured, closing or reloading the tab asks first');
  await sleep(4000);
  await tap('Stop recording');
  await expectText('That capture could not be saved', 'a capture that cannot be stored says so', 30000);
  await expectText('captured, not saved yet');
  log((await shows('Try again')) && (await shows('Save as a file')) && (await shows('Discard capture')), 'and offers to try again, save it as a file, or discard it');
  log(await asksBeforeLeaving(), 'with a capture waiting to be saved, leaving still asks first');
  await shot('34-capture-unsaved');
  await tap('Try again');
  await sleep(600);
  for (let i = 0; i < 60 && !(await shows('Try again')); i++) await sleep(250);
  log(/That capture could not be saved/.test(await text()), 'trying again while storage still fails keeps the capture in hand');
  had = downloads().length;
  await tap('Save as a file');
  await expectText(/Saved to your downloads as Untitled beat \d+\.wav/, 'a capture that cannot be stored can be saved as a file', 20000);
  const beatFile = (await waitDownloads(had + 1)).find((f) => /^Untitled beat \d+\.wav$/.test(f));
  const beatBytes = beatFile ? fs.readFileSync(path.join(DOWNLOADS, beatFile)) : null;
  log(!!beatBytes && beatBytes.toString('latin1', 0, 4) === 'RIFF' && beatBytes.readUInt16LE(22) === 2 && beatBytes.length > 200000, 'the file is the capture, as a stereo WAV', beatBytes ? `${beatFile}, ${beatBytes.length} bytes` : 'missing');
  log(await shows('Try again'), 'and the capture is still in hand, in case storage comes back');
  // Discarding listens for a new capture, which the test tone starts straight away.
  await tap('Discard capture');
  await expectText('Recording', 'discarding it listens for a new capture', 8000);
  log(!/could not be saved/.test(await text()), 'with the message gone');
  await sleep(4000);
  await tap('Stop recording');
  await expectText('That capture could not be saved', 'the next capture fails the same way', 30000);
  await setFault(null);
  await tap('Try again');
  await expectText('Nothing recorded over this beat yet', 'trying again once storage works saves the capture and opens its Song page', 30000);
  log(!(await asksBeforeLeaving()), 'and the tab can be closed again');
  await tap('Song');
  await tap('Beat details', { exact: false });
  await expectText('Beat captured', 'as a captured beat');

  if (!hasBackup) return;

  // ----- A backup that will not take a file, or has no room -----
  if (limits) {
    await openSettings();
    await expectText(/Backed up, except \d+ files? too big to back up\./, 'Settings says when files were too big to back up', 90000);
    await shot('35-backup-too-big');
    await tap('Vault');
    await expectText('Backed up, except files too big to back up.', 'and so does the Vault');
    // Now any one file is fine, but the backup as a whole has no room for more.
    setLimits({ total: 0.001 });
    await openSettings();
    // Showing the restore code runs a backup first.
    await openRow('Move to another device');
    await tap("Show this device's restore code");
    await expectText('The backup is full, so newer work is only on this device. Delete songs you no longer need to make room.', 'Settings says when the backup is full', 60000);
    await shot('36-backup-full');
    await tap('Hide the code');
    await tap('Vault');
    await expectText('The backup is full; newer work is only on this device.', 'and so does the Vault');
    // With the limits gone, what was left out goes up.
    restoreLimits();
    await openSettings();
    await openRow('Move to another device');
    await tap("Show this device's restore code");
    await expectText('Everything is backed up', 'once there is room again the rest is backed up', 90000);
    await tap('Hide the code');
  }

  // ----- Deleting everything while the server cannot be reached -----
  if (!serverOrigin) return void console.log('skip deleting everything offline: the backup server was never seen');
  await openSettings();
  await expectText('Everything is backed up', 'the backup is up to date before everything is deleted', 90000);
  const { deviceId, deviceSecret } = JSON.parse(await stored('library')).settings;
  const onServer = () =>
    fetch(`${serverOrigin}/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'backup:summary', format: 'json', args: { deviceId, secret: deviceSecret } }) })
      .then((r) => r.json())
      .then((answer) => answer.value);
  const held = await onServer();
  log(held.projects > 0 && held.files > 0, "the server holds this device's backup", JSON.stringify(held));
  offline = true;
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: [`*${new URL(serverOrigin).host}*`] });
  await tap('Delete everything on this device');
  await tap('Tap again to delete every beat, take and cover on this device');
  await expectText('Capture a beat. Freestyle over it.', 'everything on the device is deleted and the welcome opens', 30000);
  await sleep(600);
  log((await stored('', 'blobs')) === '[]' && JSON.parse(await stored('library')).projects.length === 0, 'no song or audio is left on the device');
  const owed = JSON.parse(await stored('erase'));
  log(owed?.length === 1 && owed[0].deviceId === deviceId && owed[0].secret === deviceSecret, 'the deletion the server could not be told about is kept', `${owed?.length ?? 0} kept`);
  const still = await onServer();
  log(still.projects === held.projects, 'and the copy on the server is still there for now', JSON.stringify(still));
  // Back online: the next backup run, a few seconds after launch, sends what is owed.
  await cdp.send('Network.setBlockedURLs', { urls: [] });
  await page.reload({ waitUntil: 'networkidle2' });
  offline = false;
  let gone = null;
  for (const until = Date.now() + 40000; Date.now() < until; await sleep(500)) {
    gone = await onServer();
    if (gone.projects === 0 && gone.files === 0 && (await stored('erase')) === '[]') break;
  }
  log(gone.projects === 0 && gone.files === 0, 'once the server can be reached the owed deletion is sent and the backup is gone', JSON.stringify(gone));
  log((await stored('erase')) === '[]', 'and nothing is owed any more');
}

const flows = { onboarding, song, finish, library, failures };
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
// Server settings a flow changed do not outlive the run.
restoreLimits();
if (problems.length) {
  failed++;
  console.log(`\nBrowser problems (${problems.length}):\n` + [...new Set(problems)].slice(0, 12).join('\n'));
}
if (process.env.CHATTER) console.log('\nConsole warnings and errors:\n' + [...chatter].join('\n'));
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
await browser.close();
process.exit(failed ? 1 : 0);
