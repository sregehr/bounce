// The browser audio engine: input capture, playback, recording over a beat, and the latency check.
// Everything shares one AudioContext, so playback and recording run on the same clock.
import { useSyncExternalStore } from 'react';

import { analyseClaps, analyseClicks, clickTrainSeconds, makeClickTrain, TAPS, tapTrainSeconds, type LatencyResult } from '@/dsp/latency';
import { decodeRate, sniffAudio, SNIFF_BYTES } from '@/dsp/sniff';
import { parseWav } from '@/dsp/wav';

import type { Captured, EngineState, InputDevice, PlayOptions, RecordedTake, ClapRun } from './types';

const SILENCE = 0.003; // about −50 dBFS
const PREROLL_BLOCKS = 4;
const BLOCKS_PER_BAR = 4;
const HOLD_SECONDS = 60;

type Block = { l: Float32Array; r: Float32Array; frame: number };

let state: EngineState = {
  input: { status: 'idle', error: null, inputs: [], deviceId: null, label: '', output: '', sampleRate: 0, channels: 0, pair: 0, levelL: 0, levelR: 0 },
  capture: { status: 'idle', elapsed: 0, peak: 0, clipped: false, wave: [] },
  transport: { id: null, playing: false, position: 0, duration: 0, side: 'a' },
  take: { mode: 'idle', elapsed: 0, lead: 0, held: 0, level: 0, clipped: false, ended: false },
};

const listeners = new Set<() => void>();
function set<K extends keyof EngineState>(key: K, patch: Partial<EngineState[K]>) {
  state = { ...state, [key]: { ...state[key], ...patch } };
  if (key === 'transport' && 'playing' in patch) syncSession();
  listeners.forEach((fn) => fn());
}

// ---------- Lock screen and headphone controls ----------

const session = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;

function syncSession() {
  if (session) session.playbackState = !session.metadata ? 'none' : state.transport.playing ? 'playing' : 'paused';
}

/**
 * Tells the system what is playing, so the lock screen, the control centre and headphone
 * buttons show the song and can play, pause and skip within it. Pass null when nothing is.
 */
export function setNowPlaying(info: { title: string; artist: string; artwork?: string | null } | null) {
  if (!session || typeof MediaMetadata === 'undefined') return;
  session.metadata = info ? new MediaMetadata({ title: info.title, artist: info.artist, album: 'Bounce', artwork: info.artwork ? [{ src: info.artwork, sizes: '512x512' }] : [] }) : null;
  const on = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      session.setActionHandler(action, info ? handler : null);
    } catch {
      // Not every browser knows every action.
    }
  };
  on('play', () => void resume());
  on('pause', () => pause());
  on('seekto', (d) => d.seekTime != null && seek(d.seekTime));
  on('seekbackward', (d) => seek(Math.max(0, state.transport.position - (d.seekOffset ?? 10))));
  on('seekforward', (d) => seek(Math.min(state.transport.duration, state.transport.position + (d.seekOffset ?? 10))));
  syncSession();
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useEngine<T>(pick: (s: EngineState) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state), () => pick(state));
}
export const engineState = () => state;

// ---------- Audio session ----------

type SessionType = 'playback' | 'play-and-record';
const audioSession = typeof navigator !== 'undefined' ? ((navigator as Navigator & { audioSession?: { type: string } }).audioSession ?? null) : null;

/**
 * Tells the phone what kind of app this is. Left alone, Safari treats the page's sound as
 * incidental: the ringer switch silences it, and once a microphone has been open it stays
 * routed like a call. As 'playback' it is a music app, on the media volume and through the
 * silent switch. The microphone only works as 'play-and-record', so that is held just while
 * an input is open.
 */
function sessionType(type: SessionType) {
  try {
    if (audioSession && audioSession.type !== type) audioSession.type = type;
  } catch {
    // Browsers without the setting choose for themselves.
  }
}
sessionType('playback');

// ---------- Context ----------

let ctx: AudioContext | null = null;
let worklet: Promise<void> | null = null;
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;

/** The shared context, created on first use. Asking for a different sample rate rebuilds it. */
async function context(rate?: number): Promise<AudioContext> {
  if (ctx && rate && Math.abs(ctx.sampleRate - rate) > 1) {
    stopTransport();
    detachInput();
    await ctx.close().catch(() => {});
    ctx = null;
    // Nodes belong to the context that made them, so the playback gains are made again too.
    gains = null;
  }
  if (!ctx) {
    try {
      ctx = new AudioContext(rate ? { sampleRate: rate, latencyHint: 'interactive' } : { latencyHint: 'interactive' });
    } catch {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    master = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    master.connect(analyser).connect(ctx.destination);
    worklet = ctx.audioWorklet.addModule('/capture-worklet.js');
    if (stream) {
      await attachInput();
      set('input', { sampleRate: ctx.sampleRate });
    }
  }
  await worklet;
  // After a call, Siri or the screen locking, the clock is left paused or "interrupted"; either way it is started again.
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  return ctx;
}

/** Browsers start the audio clock suspended until a tap; call this from one. */
export function wake() {
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {});
}

function buffer(c: AudioContext, audio: { channels: Float32Array[]; sampleRate: number }): AudioBuffer {
  const frames = Math.max(1, audio.channels[0]?.length ?? 1);
  const out = c.createBuffer(Math.max(1, Math.min(2, audio.channels.length)), frames, audio.sampleRate);
  for (let i = 0; i < out.numberOfChannels; i++) out.copyToChannel(audio.channels[i] as Float32Array<ArrayBuffer>, i);
  return out;
}

// ---------- Input ----------

let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let node: AudioWorkletNode | null = null;
let opening: Promise<void> | null = null;

function constraints(deviceId?: string | null): MediaStreamConstraints {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      // Music, not speech: turn off every voice-processing stage.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 32 },
    },
  };
}

/** Chrome appends the USB vendor:product id, e.g. "MPC LIVE III (09e8:0058)". */
const cleanLabel = (label: string) => label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').replace(/^Default - /, '').trim();

async function listInputs(): Promise<InputDevice[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d) => ({ deviceId: d.deviceId, label: cleanLabel(d.label) || 'Audio input' }));
}

/** The speaker or headphones in use. Safari on a phone lists none, and then this is empty. */
async function outputLabel(): Promise<string> {
  const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
  const current = outs.find((d) => d.deviceId === 'default') ?? (outs.length === 1 ? outs[0] : undefined);
  return current ? cleanLabel(current.label) : '';
}

// Plugging in or pairing something changes the timing, so the setup is read again.
if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (state.input.status !== 'ready') return;
    void Promise.all([listInputs(), outputLabel()]).then(([inputs, output]) => {
      const label = stream?.getAudioTracks()[0]?.label;
      set('input', { inputs, output, ...(label ? { label: cleanLabel(label) } : {}) });
    });
  });
}

function describe(e: unknown) {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return 'Audio input is blocked. Allow microphone access for this site in the address bar, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No audio input found. Check the cable, or pick another input.';
  if (name === 'NotReadableError') return 'The input is in use by another app.';
  return e instanceof Error ? e.message : 'Could not open the audio input.';
}

async function attachInput() {
  if (!ctx || !stream) return;
  await worklet;
  node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCountMode: 'max', channelInterpretation: 'discrete' });
  node.port.onmessage = (e) => onBlock(e.data);
  node.port.postMessage({ pair: state.input.pair });
  // The graph only runs when it reaches the destination; the gain keeps the input out of the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source = ctx.createMediaStreamSource(stream);
  source.connect(node).connect(mute).connect(ctx.destination);
}

function detachInput() {
  node?.port.close();
  node?.disconnect();
  source?.disconnect();
  node = null;
  source = null;
}

/** True when the browser has already been given microphone access, so opening will not prompt. */
export async function inputAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

// Samplers and grooveboxes a beat is likely to come from, by the names they report.
const SAMPLERS = /mpc|akai|maschine|native instruments|sp-?404|roland|verselab|elektron|digitakt|octatrack|syntakt|teenage|op-?1|op-?z|polyend|novation|circuit|ableton|deluge|synthstrom|korg|electribe|volca/i;
// Audio interfaces carry a beat too, but a vocal microphone is just as likely to be plugged into one.
const INTERFACES = /scarlett|focusrite|audient|motu|presonus|behringer|steinberg|universal audio|apollo|interface|usb audio|line in/i;
const BEAT_GEAR = new RegExp(`${SAMPLERS.source}|${INTERFACES.source}`, 'i');
const MUSIC_GEAR = new RegExp(`${SAMPLERS.source}|rane|serato|pioneer|traktor|blackhole|loopback|soundflower|aggregate`, 'i');
const MICROPHONE = /microphone|\bmic\b|built-in|airpods|headset|headphones|webcam|facetime/i;

/**
 * Opens an input and starts metering. With no id, the kind of input the caller wants is
 * looked for first. For capturing beats that is a sampler or audio interface: one known by
 * name, or else anything that is not a microphone when the system default is one. For vocals
 * it is a microphone, rather than studio gear that happens to be the system default.
 */
export function openInput(deviceId?: string | null, prefer: 'gear' | 'mic' = 'gear'): Promise<void> {
  if (opening) return opening;
  opening = doOpen(deviceId, prefer).finally(() => {
    opening = null;
  });
  return opening;
}

async function doOpen(deviceId: string | null | undefined, prefer: 'gear' | 'mic') {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    set('input', { status: 'error', error: 'This browser cannot record audio here. The page has to be opened over HTTPS or on localhost.' });
    return;
  }
  closeInput(true);
  sessionType('play-and-record');
  set('input', { status: 'opening', error: null, levelL: 0, levelR: 0 });
  try {
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia(constraints(deviceId));
    } catch (e) {
      // A remembered device that is no longer plugged in: fall back to whatever is there.
      if (deviceId && e instanceof DOMException && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) s = await navigator.mediaDevices.getUserMedia(constraints(null));
      else throw e;
    }
    const inputs = await listInputs();
    if (!deviceId) {
      const track0 = s.getAudioTracks()[0];
      const current = track0.getSettings().deviceId;
      const better =
        prefer === 'gear'
          ? (inputs.find((d) => SAMPLERS.test(d.label) && !MICROPHONE.test(d.label)) ?? inputs.find((d) => BEAT_GEAR.test(d.label) && !MICROPHONE.test(d.label)) ?? (MICROPHONE.test(track0.label) ? inputs.find((d) => !MICROPHONE.test(d.label)) : undefined))
          : MUSIC_GEAR.test(track0.label)
            ? inputs.find((d) => MICROPHONE.test(d.label) && !MUSIC_GEAR.test(d.label))
            : undefined;
      if (better && better.deviceId !== current) {
        s.getTracks().forEach((t) => t.stop());
        s = await navigator.mediaDevices.getUserMedia(constraints(better.deviceId));
      }
    }
    stream = s;
    const track = s.getAudioTracks()[0];
    const settings = track.getSettings();
    track.onended = () => {
      // Keep whatever was being captured when the cable came out, and whatever a take had got to.
      salvaged = stopCapture();
      loseTake('disconnected');
      closeInput(true);
      set('input', { status: 'idle', error: 'The input was disconnected.', levelL: 0, levelR: 0, muted: false });
    };
    // A muted track keeps sending blocks, all silence: a hardware mute switch, or a call taking the
    // microphone. Brief blips are let through; a mute that lasts ends the take where it was.
    track.onmute = () => {
      clearTimeout(muteTimer);
      muteTimer = setTimeout(() => {
        if (stream?.getAudioTracks()[0] !== track || !track.muted) return;
        set('input', { muted: true });
        loseTake('muted');
      }, MUTE_GRACE_MS);
    };
    track.onunmute = () => {
      clearTimeout(muteTimer);
      if (stream?.getAudioTracks()[0] === track) set('input', { muted: false });
    };
    // Match the device rate so nothing is resampled on the way in, unless something is playing.
    const idle = !state.transport.playing && state.take.mode === 'idle';
    const c = await context(idle ? settings.sampleRate : undefined);
    if (!node) await attachInput();
    set('input', {
      status: 'ready',
      error: null,
      inputs,
      deviceId: settings.deviceId ?? deviceId ?? null,
      label: cleanLabel(track.label) || 'Audio input',
      output: await outputLabel().catch(() => ''),
      sampleRate: c.sampleRate,
      channels: settings.channelCount ?? 0,
      pair: 0,
      muted: false,
    });
    if (track.muted) track.onmute?.(new Event('mute'));
  } catch (e) {
    closeInput(true);
    set('input', { status: 'error', error: describe(e) });
  }
}

let salvaged: Captured | null = null;
/** Said wherever a take cannot start, or has stopped, because the microphone is sending nothing. */
const MUTED = 'The microphone is muted. Unmute it, or end the call that is using it, then try again.';
let muteTimer: ReturnType<typeof setTimeout> | undefined;
const MUTE_GRACE_MS = 1000;

/** A capture that was cut short by the input disconnecting, handed over once. */
export function takeSalvaged(): Captured | null {
  const out = salvaged;
  salvaged = null;
  return out;
}

export function closeInput(quiet = false) {
  cancelCapture();
  detachInput();
  clearTimeout(muteTimer);
  stream?.getTracks().forEach((t) => {
    t.onended = null;
    t.onmute = null;
    t.onunmute = null;
    t.stop();
  });
  stream = null;
  sessionType('playback');
  if (!quiet) set('input', { status: 'idle', error: null, levelL: 0, levelR: 0, muted: false });
}

export function setPair(pair: number) {
  node?.port.postMessage({ pair });
  set('input', { pair });
}

// ---------- Incoming audio ----------

let preroll: Block[] = [];
let chunks: Block[] = [];
let frames = 0;
let barPeak = 0;
let barBlocks = 0;

type TakeRun = { mode: 'listening' | 'recording'; lost?: boolean; startFrame: number; loopFrames: number | null; blocks: Block[]; held: number; peak: number; clipped: boolean; beat: AudioBufferSourceNode; clicks: OscillatorNode[] };
let run: TakeRun | null = null;
let probe: { startFrame: number; need: number; blocks: Block[]; got: number; done: (heard: Float32Array) => void } | null = null;

function blockPeak(a: Float32Array) {
  let p = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] < 0 ? -a[i] : a[i];
    if (v > p) p = v;
  }
  return p;
}

function onBlock(msg: { peaks: Float32Array; l: Float32Array; r: Float32Array; pair: number; frame: number; mono?: boolean }) {
  if (!ctx) return;
  const { peaks, l, r, frame } = msg;
  const lp = blockPeak(l);
  const rp = blockPeak(r);
  const loud = Math.max(lp, rp);
  set('input', { channels: msg.mono ? 1 : peaks.length, pair: msg.pair, levelL: Math.max(lp, state.input.levelL * 0.8), levelR: Math.max(rp, state.input.levelR * 0.8) });

  if (probe) {
    probe.blocks.push({ l, r, frame });
    probe.got = frame + l.length - probe.startFrame;
    if (probe.got >= probe.need) {
      const p = probe;
      probe = null;
      p.done(monoFrom(p.blocks, p.startFrame, p.need).mono);
    }
    return;
  }

  if (run) {
    // After the microphone has gone, what still arrives is silence; the take ends where it was.
    if (run.lost) return;
    if (frame + l.length > run.startFrame) {
      run.blocks.push({ l, r, frame });
      run.held += l.length;
      run.peak = Math.max(run.peak, loud);
      if (loud >= 0.999) run.clipped = true;
      if (run.mode === 'listening') {
        // Keep only the last minute.
        const cap = HOLD_SECONDS * ctx.sampleRate;
        while (run.blocks.length > 1 && run.held - run.blocks[0].l.length >= cap) run.held -= run.blocks.shift()!.l.length;
      }
    }
    const elapsed = Math.max(0, (frame + l.length - run.startFrame) / ctx.sampleRate);
    set('take', { elapsed, lead: Math.max(0, (run.startFrame - (frame + l.length)) / ctx.sampleRate), held: Math.min(run.held / ctx.sampleRate, run.mode === 'listening' ? HOLD_SECONDS : Infinity), level: Math.max(loud, state.take.level * 0.8), clipped: run.clipped });
    return;
  }

  const cap = state.capture;
  if (cap.status === 'idle') {
    // Multichannel interfaces: follow whichever stereo pair carries the signal.
    let best = msg.pair, bestPeak = loud;
    for (let p = 0; p * 2 < peaks.length; p++) {
      const v = Math.max(peaks[p * 2], peaks[p * 2 + 1] ?? 0);
      if (v > bestPeak * 4 && v > SILENCE) {
        best = p;
        bestPeak = v;
      }
    }
    if (best !== msg.pair) node?.port.postMessage({ pair: best });
    return;
  }
  let status = cap.status;
  if (status === 'armed') {
    preroll.push({ l, r, frame });
    if (preroll.length > PREROLL_BLOCKS) preroll.shift();
    if (loud > SILENCE) {
      chunks = preroll;
      preroll = [];
      frames = chunks.reduce((n, c) => n + c.l.length, 0);
      status = 'recording';
    }
  } else {
    chunks.push({ l, r, frame });
    frames += l.length;
  }
  if (status === 'recording') {
    const patch: Partial<EngineState['capture']> = { status, elapsed: frames / ctx.sampleRate, peak: Math.max(cap.peak, loud), clipped: cap.clipped || loud >= 0.999 };
    barPeak = Math.max(barPeak, loud);
    if (++barBlocks >= BLOCKS_PER_BAR) {
      patch.wave = [...cap.wave.slice(-200), barPeak];
      barPeak = 0;
      barBlocks = 0;
    }
    set('capture', patch);
  }
}

// ---------- Capturing a beat ----------

function resetCapture() {
  preroll = [];
  chunks = [];
  frames = 0;
  barPeak = 0;
  barBlocks = 0;
}

/** Wait for the first sound, then record. */
export function armCapture() {
  if (state.input.status !== 'ready') return;
  wake();
  resetCapture();
  set('capture', { status: 'armed', elapsed: 0, peak: 0, clipped: false, wave: [] });
}

/** Start recording now instead of waiting for sound. */
export function startCaptureNow() {
  if (state.capture.status !== 'armed') return;
  chunks = preroll;
  preroll = [];
  frames = chunks.reduce((n, c) => n + c.l.length, 0);
  set('capture', { status: 'recording' });
}

/** Stop and hand back what was recorded, or null if recording never started. */
export function stopCapture(): Captured | null {
  const cap = state.capture;
  if (cap.status === 'idle') return null;
  let out: Captured | null = null;
  if (cap.status === 'recording' && frames > 0 && ctx) {
    const L = new Float32Array(frames), R = new Float32Array(frames);
    let at = 0;
    for (const c of chunks) {
      L.set(c.l, at);
      R.set(c.r, at);
      at += c.l.length;
    }
    out = { channels: [L, R], sampleRate: ctx.sampleRate, peak: cap.peak, clipped: cap.clipped, label: state.input.label };
  }
  resetCapture();
  set('capture', { status: 'idle' });
  return out;
}

export function cancelCapture() {
  if (state.capture.status === 'idle') return;
  resetCapture();
  set('capture', { status: 'idle', elapsed: 0, wave: [] });
}

// ---------- Playback ----------

type Loaded = { a: AudioBuffer; b: AudioBuffer | null; loop: boolean; /** Gain on the main side, 1 or below. */ trim: number };
let loaded: Loaded | null = null;
let sources: AudioBufferSourceNode[] = [];
let gains: { a: GainNode; b: GainNode } | null = null;
let startedAt = 0;
let startedFrom = 0;
let raf = 0;

function clearSources() {
  for (const s of sources) {
    s.onended = null;
    try {
      s.stop();
    } catch {
      // Already stopped.
    }
    s.disconnect();
  }
  sources = [];
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function currentPosition() {
  if (!ctx || !loaded || !state.transport.playing) return state.transport.position;
  const t = Math.max(0, ctx.currentTime - startedAt) + startedFrom;
  return loaded.loop ? t % loaded.a.duration : Math.min(t, loaded.a.duration);
}

function watch() {
  let last = 0;
  const step = (now: number) => {
    if (!state.transport.playing) return;
    if (now - last > 50) {
      last = now;
      set('transport', { position: currentPosition() });
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

function begin(from: number) {
  if (!ctx || !loaded || !master) return;
  clearSources();
  if (!gains) {
    gains = { a: ctx.createGain(), b: ctx.createGain() };
    gains.a.connect(master);
    gains.b.connect(master);
  }
  const side = state.transport.side;
  gains.a.gain.value = side === 'a' || !loaded.b ? loaded.trim : 0;
  gains.b.gain.value = side === 'b' && loaded.b ? 1 : 0;
  const when = ctx.currentTime + 0.03;
  const offset = Math.max(0, Math.min(from, loaded.a.duration - 0.01));
  const make = (buf: AudioBuffer, gain: GainNode) => {
    const s = ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = loaded!.loop;
    s.connect(gain);
    s.start(when, Math.min(offset, buf.duration - 0.01));
    sources.push(s);
    return s;
  };
  const main = make(loaded.a, gains.a);
  if (loaded.b) make(loaded.b, gains.b);
  main.onended = () => {
    clearSources();
    set('transport', { playing: false, position: 0 });
  };
  startedAt = when;
  startedFrom = offset;
  set('transport', { playing: true, position: offset });
  watch();
}

/** Loads audio (and optionally a second version to compare) and starts playing. */
export async function play(id: string, options: PlayOptions) {
  const keep = options.keepPosition && state.transport.id === id;
  const wasPlaying = state.transport.playing;
  const position = keep ? currentPosition() : (options.from ?? 0);
  const c = await context(state.input.status === 'ready' || state.take.mode !== 'idle' ? undefined : options.a.sampleRate);
  const a = buffer(c, options.a);
  loaded = { a, b: options.b ? buffer(c, options.b) : null, loop: !!options.loop, trim: Math.min(1, 10 ** ((options.trimDb ?? 0) / 20)) };
  set('transport', { id, duration: a.duration, side: options.side ?? (keep ? state.transport.side : 'a') });
  const start = keep ? wasPlaying : options.autoplay !== false;
  if (start && c.state === 'running') begin(Math.min(position, a.duration - 0.05));
  else {
    clearSources();
    set('transport', { playing: false, position: Math.min(position, a.duration) });
  }
}

export function pause() {
  if (!state.transport.playing) return;
  const position = currentPosition();
  clearSources();
  set('transport', { playing: false, position });
}

export async function resume() {
  if (!loaded || state.transport.playing) return;
  await context();
  begin(state.transport.position >= loaded.a.duration - 0.05 ? 0 : state.transport.position);
}

export function toggle() {
  if (state.transport.playing) pause();
  else void resume();
}

export function seek(seconds: number) {
  if (!loaded) return;
  const to = Math.max(0, Math.min(seconds, loaded.a.duration));
  if (state.transport.playing) begin(to);
  else set('transport', { position: to });
}

/** Switches between the two loaded versions without losing the place. */
export function setSide(side: 'a' | 'b') {
  set('transport', { side });
  if (!ctx || !gains || !loaded?.b) return;
  const t = ctx.currentTime;
  gains.a.gain.setTargetAtTime(side === 'a' ? loaded.trim : 0, t, 0.01);
  gains.b.gain.setTargetAtTime(side === 'b' ? 1 : 0, t, 0.01);
}

export function stopTransport() {
  clearSources();
  loaded = null;
  set('transport', { id: null, playing: false, position: 0, duration: 0 });
}

/** Levels across the spectrum for the visualiser, each 0–1. */
export function spectrum(bars: number): number[] {
  if (!analyser || !state.transport.playing) return new Array(bars).fill(0);
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const out: number[] = [];
  // Spread the bars evenly by pitch rather than by frequency, so the bass does not hog them.
  const top = data.length * 0.75;
  for (let i = 0; i < bars; i++) {
    const from = Math.floor(Math.pow(top, i / bars));
    const to = Math.max(from + 1, Math.floor(Math.pow(top, (i + 1) / bars)));
    let peak = 0;
    for (let k = from; k < to && k < data.length; k++) peak = Math.max(peak, data[k]);
    out.push(peak / 255);
  }
  return out;
}

// ---------- Recording over a beat ----------

function monoFrom(blocks: Block[], startFrame: number, limit?: number): { mono: Float32Array; firstFrame: number } {
  const usable = blocks.filter((b) => b.frame + b.l.length > startFrame);
  if (usable.length === 0) return { mono: new Float32Array(limit ?? 0), firstFrame: startFrame };
  const first = Math.max(startFrame, usable[0].frame);
  const end = usable[usable.length - 1].frame + usable[usable.length - 1].l.length;
  const length = limit ?? end - first;
  const L = new Float32Array(length), R = new Float32Array(length);
  let sumL = 0, sumR = 0;
  for (const b of usable) {
    for (let i = 0; i < b.l.length; i++) {
      const at = b.frame + i - first;
      if (at < 0 || at >= length) continue;
      L[at] = b.l[i];
      R[at] = b.r[i];
      sumL += b.l[i] * b.l[i];
      sumR += b.r[i] * b.r[i];
    }
  }
  // A microphone is one channel: use whichever side carries it, or both when both do.
  if (sumR < sumL * 0.01) return { mono: L, firstFrame: first };
  if (sumL < sumR * 0.01) return { mono: R, firstFrame: first };
  for (let i = 0; i < length; i++) L[i] = (L[i] + R[i]) * 0.5;
  return { mono: L, firstFrame: first };
}

/**
 * Plays the beat (looping a region, or once through) and takes in the input from the same instant.
 * `listening` keeps only the last minute, for "keep that"; `recording` keeps everything.
 * `countIn` plays that many clicks, one per beat, before the beat starts; nothing is recorded during them.
 */
export async function startTake(mode: 'listening' | 'recording', beat: { channels: Float32Array[]; sampleRate: number }, loop: { start: number; end: number } | null, countIn?: { beats: number; beatSec: number }) {
  if (state.input.status !== 'ready') throw new Error('Connect a microphone first.');
  if (state.input.muted) throw new Error(MUTED);
  endRun();
  stopTransport();
  // Run the audio clock at the beat's own rate, so the take is recorded at that rate too.
  const c = await context(beat.sampleRate);
  if (c.state !== 'running') throw new Error('The browser has paused audio. Tap the page and try again.');
  const src = c.createBufferSource();
  src.buffer = buffer(c, beat);
  src.connect(master!);
  const lead = countIn ? countIn.beats * countIn.beatSec : 0;
  const first = c.currentTime + 0.25;
  const when = first + lead;
  const clicks: OscillatorNode[] = [];
  for (let i = 0; countIn && i < countIn.beats; i++) {
    // A short tick on each beat, the first one higher, the way a drummer counts a band in.
    const at = first + i * countIn.beatSec;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.frequency.value = i === 0 ? 1568 : 1047;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.35, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    osc.connect(env).connect(master!);
    osc.start(at);
    osc.stop(at + 0.08);
    clicks.push(osc);
  }
  if (loop) {
    src.loop = true;
    src.loopStart = loop.start;
    src.loopEnd = loop.end;
    src.start(when, loop.start);
  } else {
    src.start(when, 0);
    src.onended = () => set('take', { ended: true });
  }
  run = {
    mode,
    startFrame: Math.round(when * c.sampleRate),
    // Resampled playback changes the loop's length on the context clock.
    loopFrames: loop ? Math.round((loop.end - loop.start) * c.sampleRate) : null,
    blocks: [],
    held: 0,
    peak: 0,
    clipped: false,
    beat: src,
    clicks,
  };
  set('take', { mode, elapsed: 0, lead, held: 0, level: 0, clipped: false, ended: false, lost: null });
}

/** Stops the beat, and silences any count-in still to come. */
function silenceRun(r: TakeRun) {
  r.beat.onended = null;
  try {
    r.beat.stop();
  } catch {
    // Already stopped.
  }
  r.beat.disconnect();
  for (const click of r.clicks) {
    try {
      click.stop();
    } catch {
      // Already played.
    }
    click.disconnect();
  }
}

/**
 * The microphone went away mid-take. The beat stops, so nobody carries on into a dead microphone,
 * and what was recorded so far stays in hand: `stopTake` still returns it.
 */
function loseTake(why: 'disconnected' | 'muted') {
  if (!run || run.lost) return;
  run.lost = true;
  silenceRun(run);
  set('take', { lost: why, level: 0 });
}

function endRun() {
  if (!run) return;
  silenceRun(run);
  run = null;
}

/** Stops the beat and returns what was recorded (or held, when listening), or null if there is nothing. */
export function stopTake(keep = true): RecordedTake | null {
  const r = run;
  if (!r || !ctx) {
    set('take', { mode: 'idle', ended: false, lead: 0, lost: null });
    return null;
  }
  const rate = ctx.sampleRate;
  endRun();
  set('take', { mode: 'idle', ended: false, level: 0, lead: 0, lost: null });
  if (!keep || r.blocks.length === 0) return null;
  const { mono, firstFrame } = monoFrom(r.blocks, r.startFrame);
  if (mono.length < rate * 0.2) return null;
  const since = firstFrame - r.startFrame;
  return { mono, sampleRate: rate, phaseSec: r.loopFrames ? (since % r.loopFrames) / rate : since / rate, peak: r.peak, clipped: r.clipped };
}

/** The delay the browser reports between its clock and the speakers plus the input, in milliseconds. */
export function reportedLatencyMs(): number {
  if (!ctx) return 30;
  const out = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  return Math.round(out * 1000 + inputLatencyMs());
}

/** The input's share of the delay, as the browser reports it. */
function inputLatencyMs(): number {
  const track = stream?.getAudioTracks()[0];
  return ((track?.getSettings() as { latency?: number } | undefined)?.latency ?? 0.01) * 1000;
}

/**
 * Plays a steady pulse and listens for the artist clapping along to it, for setups where the input cannot
 * hear the output (earbuds). What comes back is the whole delay a vocal suffers: out to the ears and in through the mic.
 */
export async function startClapCheck(): Promise<ClapRun> {
  if (state.input.status !== 'ready') throw new Error('Connect a microphone first.');
  endRun();
  stopTransport();
  const c = await context();
  const src = c.createBufferSource();
  src.buffer = buffer(c, { channels: [makeClickTrain(c.sampleRate, TAPS)], sampleRate: c.sampleRate });
  src.connect(master!);
  const audioNow = c.currentTime;
  const clockNow = performance.now();
  const when = audioNow + 0.25;
  let finish: (heard: Float32Array) => void = () => {};
  const heard = new Promise<Float32Array>((resolve) => (finish = resolve));
  const mine = { startFrame: Math.round(when * c.sampleRate), need: Math.round(tapTrainSeconds * c.sampleRate), blocks: [], got: 0, done: finish };
  probe = mine;
  src.start(when);
  const timer = setTimeout(() => finish(new Float32Array(0)), (tapTrainSeconds + 2) * 1000);
  const end = () => {
    clearTimeout(timer);
    if (probe === mine) probe = null;
    try {
      src.stop();
    } catch {}
    src.disconnect();
  };
  const startsAt = clockNow + (when - audioNow) * 1000;
  return {
    clicksAt: Array.from({ length: TAPS.count }, (_, k) => startsAt + (TAPS.first + TAPS.spacing * k) * 1000),
    result: heard.then((samples) => (end(), analyseClaps(samples, c.sampleRate))),
    stop: () => (end(), finish(new Float32Array(0))),
  };
}

/** Plays clicks and times how long they take to come back in through the input. */
export async function measureLatency(): Promise<LatencyResult> {
  if (state.input.status !== 'ready') throw new Error('Connect a microphone first.');
  endRun();
  stopTransport();
  const c = await context();
  const src = c.createBufferSource();
  src.buffer = buffer(c, { channels: [makeClickTrain(c.sampleRate)], sampleRate: c.sampleRate });
  src.connect(master!);
  const when = c.currentTime + 0.25;
  const heard = new Promise<Float32Array>((resolve) => {
    probe = { startFrame: Math.round(when * c.sampleRate), need: Math.round(clickTrainSeconds * c.sampleRate), blocks: [], got: 0, done: resolve };
  });
  src.start(when);
  const timeout = new Promise<Float32Array>((resolve) => setTimeout(() => resolve(new Float32Array(0)), (clickTrainSeconds + 2) * 1000));
  const samples = await Promise.race([heard, timeout]);
  probe = null;
  src.disconnect();
  return analyseClicks(samples, c.sampleRate);
}

// ---------- Decoding ----------

/**
 * Decodes any audio file the browser understands. Our own WAVs are read directly, at their own rate.
 * Everything else is decoded away from the live audio clock, at 44.1 or 48 kHz to suit the file:
 * the live clock follows the microphone, and after a headset microphone it can be running at
 * 16 or 24 kHz, which is no rate to keep a beat at.
 */
export async function decode(data: ArrayBuffer): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const wav = parseWav(data);
  if (wav) return { channels: wav.channels.slice(0, 2), sampleRate: wav.sampleRate };
  const bytes = new Uint8Array(data);
  const rate = decodeRate(sniffAudio(bytes.subarray(0, SNIFF_BYTES), bytes.length, bytes.subarray(Math.max(0, bytes.length - SNIFF_BYTES))).sampleRate);
  let c: BaseAudioContext;
  try {
    c = new OfflineAudioContext(2, 1, rate);
  } catch {
    // A browser with no offline decoder: the live clock is better than not opening the file.
    c = await context();
  }
  // The decoder takes the buffer for itself, which no caller minds, and which saves a copy of the file.
  // Older Safari only takes callbacks; newer browsers return a promise as well.
  const decoded = await new Promise<AudioBuffer>((resolve, reject) => void c.decodeAudioData(data, resolve, reject)?.then(resolve, reject));
  const channels: Float32Array[] = [];
  for (let i = 0; i < Math.min(2, decoded.numberOfChannels); i++) channels.push(decoded.getChannelData(i).slice());
  return { channels, sampleRate: decoded.sampleRate };
}

export const supported = typeof window !== 'undefined' && typeof AudioContext !== 'undefined';
