import { useSyncExternalStore } from 'react'
import { diag } from './diag'
import workletUrl from './capture-worklet.js?url&no-inline'

/** Linear level below which the input counts as silence (about −50 dBFS). */
const SILENCE = 0.003
/** Blocks kept before the first sound, so the attack isn't cut off. */
const PREROLL_BLOCKS = 4
/** Blocks folded into one waveform bar on the Record screen. */
const BLOCKS_PER_BAR = 4

export type Input = { deviceId: string; label: string }

export type Take = {
  url: string
  blob: Blob
  duration: number
  sampleRate: number
  peakDb: number
  rmsDb: number
  /** Seconds of silence removed from the start and end. */
  trimmed: number
  clipped: boolean
  /** Normalised 0–1 peaks across the whole take. */
  wave: number[]
  source: string
}

export type CaptureState = {
  status: 'idle' | 'opening' | 'ready' | 'armed' | 'recording' | 'error'
  error: string | null
  inputs: Input[]
  deviceId: string | null
  label: string
  sampleRate: number
  channels: number
  /** Zero-based stereo pair being captured: 0 is channels 1–2. */
  pair: number
  levelL: number
  levelR: number
  elapsed: number
  peak: number
  clipped: boolean
  /** Linear peak per waveform bar since recording started. */
  wave: number[]
  take: Take | null
}

let state: CaptureState = {
  status: 'idle',
  error: null,
  inputs: [],
  deviceId: null,
  label: '',
  sampleRate: 0,
  channels: 0,
  pair: 0,
  levelL: 0,
  levelR: 0,
  elapsed: 0,
  peak: 0,
  clipped: false,
  wave: [],
  take: null,
}

const listeners = new Set<() => void>()
function set(patch: Partial<CaptureState>) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}
function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useCapture() {
  return useSyncExternalStore(subscribe, () => state)
}

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let node: AudioWorkletNode | null = null
let opening: Promise<void> | null = null

let preroll: [Float32Array, Float32Array][] = []
let chunks: [Float32Array, Float32Array][] = []
let frames = 0
let barPeak = 0
let barBlocks = 0

// Diagnostics: what arrived since the last report.
let seenBlocks = 0
let seenPeaks: number[] = []
let reporter: ReturnType<typeof setInterval> | null = null

function constraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      // Music, not speech: turn off every voice-processing stage.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 32 },
    },
  }
}

async function listInputs(): Promise<Input[]> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return all
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d) => ({ deviceId: d.deviceId, label: cleanLabel(d.label) || 'Audio input' }))
}

/** Chrome appends the USB vendor:product id, e.g. "MPC LIVE III (09e8:0058)". */
function cleanLabel(label: string) {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim()
}

function teardown() {
  if (reporter) clearInterval(reporter)
  reporter = null
  node?.port.close()
  node?.disconnect()
  node = null
  stream?.getTracks().forEach((t) => {
    t.onended = null
    t.stop()
  })
  stream = null
  void ctx?.close()
  ctx = null
  preroll = []
  chunks = []
  frames = 0
}

function describe(e: unknown) {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError') return 'Audio input is blocked. Allow microphone access for this site, then try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No audio input found. Check the USB cable.'
  if (name === 'NotReadableError') return 'The input is in use by another app.'
  return e instanceof Error ? e.message : 'Could not open the audio input.'
}

/** Open an input and start metering. With no id, an MPC is preferred if one is connected. */
export function open(deviceId?: string): Promise<void> {
  if (opening) return opening
  opening = doOpen(deviceId).finally(() => {
    opening = null
  })
  return opening
}

async function doOpen(deviceId?: string) {
  if (!navigator.mediaDevices?.getUserMedia) {
    set({ status: 'error', error: 'This browser cannot record audio here. The page must be served over HTTPS.' })
    return
  }
  teardown()
  set({ status: 'opening', error: null, levelL: 0, levelR: 0 })
  try {
    let s = await navigator.mediaDevices.getUserMedia(constraints(deviceId))
    const inputs = await listInputs()
    if (!deviceId) {
      const preferred = inputs.find((d) => /mpc|akai/i.test(d.label))
      const current = s.getAudioTracks()[0].getSettings().deviceId
      if (preferred && preferred.deviceId !== current) {
        s.getTracks().forEach((t) => t.stop())
        s = await navigator.mediaDevices.getUserMedia(constraints(preferred.deviceId))
      }
    }
    stream = s
    const track = s.getAudioTracks()[0]
    const settings = track.getSettings()

    // Match the device rate so nothing is resampled on the way in.
    try {
      ctx = new AudioContext({ sampleRate: settings.sampleRate, latencyHint: 'playback' })
    } catch {
      ctx = new AudioContext({ latencyHint: 'playback' })
    }
    await ctx.audioWorklet.addModule(workletUrl)
    node = new AudioWorkletNode(ctx, 'capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCountMode: 'max',
      channelInterpretation: 'discrete',
    })
    node.port.onmessage = (e) => onBlock(e.data)
    // The graph only runs when it reaches the destination; the gain keeps it silent.
    const mute = ctx.createGain()
    mute.gain.value = 0
    ctx.createMediaStreamSource(s).connect(node).connect(mute).connect(ctx.destination)
    void ctx.resume()
    ctx.onstatechange = () => diag('context', ctx?.state)

    diag('open', {
      ua: navigator.userAgent,
      label: track.label,
      settings,
      capabilities: track.getCapabilities?.(),
      inputs: inputs.map((d) => d.label),
      contextRate: ctx.sampleRate,
      contextState: ctx.state,
    })
    seenBlocks = 0
    seenPeaks = []
    reporter = setInterval(() => {
      diag('levels', {
        status: state.status,
        context: ctx?.state,
        blocks: seenBlocks,
        pair: state.pair,
        // dBFS peak per channel since the last report; null is digital silence.
        db: seenPeaks.map((p) => (p > 0 ? Math.round(toDb(p)) : null)),
      })
      seenBlocks = 0
      seenPeaks = []
    }, 2000)

    track.onended = () => {
      diag('track.ended')
      teardown()
      set({ status: 'idle', error: 'The input was disconnected.', levelL: 0, levelR: 0 })
    }

    set({
      status: 'ready',
      inputs,
      deviceId: settings.deviceId ?? deviceId ?? null,
      label: cleanLabel(track.label) || 'Audio input',
      sampleRate: ctx.sampleRate,
      channels: settings.channelCount ?? 0,
      pair: 0,
    })
  } catch (e) {
    diag('open.error', String(e))
    teardown()
    set({ status: 'error', error: describe(e) })
  }
}

export function close() {
  teardown()
  set({ status: 'idle', error: null, levelL: 0, levelR: 0 })
}

/** Browsers may start the audio clock suspended until a tap; call this from one. */
export function wake() {
  void ctx?.resume()
}

/** Wait for the first sound, then record. */
export function arm() {
  if (state.status !== 'ready') return
  wake()
  preroll = []
  chunks = []
  frames = 0
  barPeak = 0
  barBlocks = 0
  set({ status: 'armed', elapsed: 0, peak: 0, clipped: false, wave: [] })
}

/** Stop and keep the take. Returns null if nothing was recorded. */
export function stop(): Take | null {
  if (state.status !== 'armed' && state.status !== 'recording') return null
  const take = state.status === 'recording' ? buildTake() : null
  preroll = []
  chunks = []
  frames = 0
  if (take && state.take) URL.revokeObjectURL(state.take.url)
  set({ status: 'ready', ...(take ? { take } : null) })
  return take
}

/** Drop whatever is armed or being recorded. */
export function cancel() {
  if (state.status !== 'armed' && state.status !== 'recording') return
  preroll = []
  chunks = []
  frames = 0
  set({ status: 'ready' })
}

function blockPeak(a: Float32Array) {
  let p = 0
  for (let i = 0; i < a.length; i++) {
    const v = a[i] < 0 ? -a[i] : a[i]
    if (v > p) p = v
  }
  return p
}

function onBlock(msg: { peaks: Float32Array; l: Float32Array; r: Float32Array; pair: number }) {
  if (!ctx) return
  const { peaks, l, r } = msg
  seenBlocks++
  for (let c = 0; c < peaks.length; c++) seenPeaks[c] = Math.max(seenPeaks[c] ?? 0, peaks[c])
  const lp = blockPeak(l)
  const rp = blockPeak(r)
  const loud = Math.max(lp, rp)
  const patch: Partial<CaptureState> = {
    channels: peaks.length,
    pair: msg.pair,
    levelL: Math.max(lp, state.levelL * 0.8),
    levelR: Math.max(rp, state.levelR * 0.8),
  }

  if (state.status === 'ready') {
    // Multichannel interfaces: follow whichever stereo pair carries the signal.
    let best = msg.pair
    let bestPeak = loud
    for (let p = 0; p * 2 < peaks.length; p++) {
      const v = Math.max(peaks[p * 2], peaks[p * 2 + 1] ?? 0)
      if (v > bestPeak * 4 && v > SILENCE) {
        best = p
        bestPeak = v
      }
    }
    if (best !== msg.pair) node?.port.postMessage({ pair: best })
  } else if (state.status === 'armed') {
    preroll.push([l, r])
    if (preroll.length > PREROLL_BLOCKS) preroll.shift()
    if (loud > SILENCE) {
      chunks = preroll
      preroll = []
      frames = chunks.reduce((n, c) => n + c[0].length, 0)
      patch.status = 'recording'
    }
  } else if (state.status === 'recording') {
    chunks.push([l, r])
    frames += l.length
  }

  if (state.status === 'recording' || patch.status === 'recording') {
    patch.elapsed = frames / ctx.sampleRate
    patch.peak = Math.max(state.peak, loud)
    patch.clipped = state.clipped || loud >= 0.999
    barPeak = Math.max(barPeak, loud)
    if (++barBlocks >= BLOCKS_PER_BAR) {
      patch.wave = [...state.wave, barPeak]
      barPeak = 0
      barBlocks = 0
    }
  }
  set(patch)
}

function buildTake(): Take {
  const sampleRate = ctx!.sampleRate
  const L = new Float32Array(frames)
  const R = new Float32Array(frames)
  let at = 0
  for (const [l, r] of chunks) {
    L.set(l, at)
    R.set(r, at)
    at += l.length
  }

  // Trim silence, leaving a short lead-in and room for the tail to ring out.
  let first = 0
  while (first < frames && Math.abs(L[first]) <= SILENCE && Math.abs(R[first]) <= SILENCE) first++
  let last = frames - 1
  while (last > first && Math.abs(L[last]) <= SILENCE && Math.abs(R[last]) <= SILENCE) last--
  const start = Math.max(0, first - Math.round(sampleRate * 0.02))
  const end = Math.min(frames, last + 1 + Math.round(sampleRate * 0.25))
  const length = Math.max(0, end - start)

  let peak = 0
  let sum = 0
  for (let i = start; i < end; i++) {
    const a = Math.abs(L[i])
    const b = Math.abs(R[i])
    if (a > peak) peak = a
    if (b > peak) peak = b
    sum += L[i] * L[i] + R[i] * R[i]
  }

  const BARS = 59
  const wave: number[] = []
  for (let b = 0; b < BARS; b++) {
    const from = start + Math.floor((b * length) / BARS)
    const to = start + Math.floor(((b + 1) * length) / BARS)
    let p = 0
    for (let i = from; i < to; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]))
    wave.push(peak > 0 ? p / peak : 0)
  }

  const blob = encodeWav(L.subarray(start, end), R.subarray(start, end), sampleRate)
  return {
    url: URL.createObjectURL(blob),
    blob,
    duration: length / sampleRate,
    sampleRate,
    peakDb: toDb(peak),
    rmsDb: toDb(Math.sqrt(sum / Math.max(1, length * 2))),
    trimmed: (frames - length) / sampleRate,
    clipped: state.clipped,
    wave,
    source: state.label,
  }
}

/** 24-bit stereo PCM WAV. */
function encodeWav(l: Float32Array, r: Float32Array, sampleRate: number) {
  const n = l.length
  const dataBytes = n * 6
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 2, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 6, true)
  v.setUint16(32, 6, true)
  v.setUint16(34, 24, true)
  text(36, 'data')
  v.setUint32(40, dataBytes, true)
  const bytes = new Uint8Array(buf, 44)
  let at = 0
  const put = (x: number) => {
    const s = Math.round(Math.max(-1, Math.min(1, x)) * 8388607)
    bytes[at++] = s & 255
    bytes[at++] = (s >> 8) & 255
    bytes[at++] = (s >> 16) & 255
  }
  for (let i = 0; i < n; i++) {
    put(l[i])
    put(r[i])
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export function toDb(linear: number) {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity
}

/** Meter fill for a linear level, on a −60 dB to 0 dB scale. */
export function meterPct(linear: number) {
  const d = toDb(linear)
  return Math.max(0, Math.min(100, ((d + 60) / 60) * 100))
}

export function clock(seconds: number) {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function rateLabel(sampleRate: number) {
  return `${Number((sampleRate / 1000).toFixed(1))} kHz`
}

export function pairLabel(s: Pick<CaptureState, 'channels' | 'pair'>) {
  if (s.channels <= 1) return 'mono'
  if (s.channels === 2) return 'stereo'
  return `channels ${s.pair * 2 + 1}–${s.pair * 2 + 2} of ${s.channels}`
}

/** Open straight away if the user has already granted access; otherwise wait for a tap. */
export async function openIfAllowed() {
  if (state.status !== 'idle') return
  try {
    const p = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    if (p.state === 'granted') await open()
  } catch {
    // Permissions API unavailable: the Connect button covers it.
  }
}

if (typeof window !== 'undefined') {
  // iOS Safari can leave the audio clock suspended until a tap; any tap wakes it.
  window.addEventListener('pointerdown', () => {
    if (ctx && ctx.state !== 'running') void ctx.resume()
  })
}

if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (state.status === 'idle' || state.status === 'error') return
    void listInputs().then((inputs) => set({ inputs }))
  })
}
