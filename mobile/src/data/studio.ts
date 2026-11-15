// Everything between the screens and the audio: loading and saving sound, making projects
// from captured or imported beats, saving takes, and rendering the mix.
import { useEffect, useRef, useState } from 'react';

import { detectKey, detectTempo } from '@/dsp/analysis';
import { integratedLufs, peakOf, toDb, trimRange, wavePeaks, type Stereo } from '@/dsp/core';
import { renderMix, renderRaw, type RenderInput, type RenderOutput, type StageCache } from '@/dsp/render';
import { encodeWav, type Pcm } from '@/dsp/wav';
import { decode } from '@/engine/engine';
import type { RecordedTake } from '@/engine/types';

import { blobBytes, blobs, makeBlob } from './db';
import { newId, type Beat, type LoopChoice, type Project, type Take } from './model';
import { activeTake, addTake, createProject, getProject, patchProject } from './store';

// ---------- Sound in and out of storage ----------

const cache = new Map<string, Pcm>();
function remember(key: string, pcm: Pcm) {
  cache.delete(key);
  cache.set(key, pcm);
  // A handful of decoded files is plenty; each can be tens of megabytes.
  while (cache.size > 6) cache.delete(cache.keys().next().value as string);
}

export async function loadPcm(key: string): Promise<Pcm> {
  const hit = cache.get(key);
  if (hit) return hit;
  const blob = await blobs.get(key);
  if (!blob) throw new Error('The audio for this is missing from this device.');
  const pcm = await decode(await blobBytes(blob));
  remember(key, pcm);
  return pcm;
}

export async function savePcm(key: string, channels: Float32Array[], sampleRate: number) {
  await blobs.put(key, makeBlob(encodeWav(channels, sampleRate, 24), 'audio/wav'));
  remember(key, { channels, sampleRate });
}

// ---------- Beats ----------

export class TooShort extends Error {}

/** Trims, measures and stores a beat, and makes a project for it. */
export async function addBeat(audio: Pcm, info: { source: Beat['source']; label: string; name: string; clipped?: boolean; trim?: boolean; bpm?: number; key?: string }): Promise<Project> {
  const left = audio.channels[0];
  const right = audio.channels[1] ?? audio.channels[0];
  const range = info.trim === false ? { start: 0, end: left.length } : trimRange([left, right], audio.sampleRate);
  const length = range.end - range.start;
  if (length < audio.sampleRate * 1) throw new TooShort('That was under a second of sound. Try again and let the beat play.');
  const channels: Stereo = [left.slice(range.start, range.end), right.slice(range.start, range.end)];
  const tempo = info.bpm ? { bpm: info.bpm } : detectTempo(channels, audio.sampleRate);
  const key = info.key ?? detectKey(channels, audio.sampleRate)?.name ?? null;
  const fileKey = `beat-${newId()}`;
  await savePcm(fileKey, channels, audio.sampleRate);
  const peak = peakOf(channels);
  return createProject(
    {
      key: fileKey,
      durationSec: length / audio.sampleRate,
      sampleRate: audio.sampleRate,
      channels: 2,
      source: info.source,
      sourceLabel: info.label,
      peakDb: toDb(peak),
      lufs: integratedLufs(channels, audio.sampleRate),
      clipped: !!info.clipped || peak >= 0.999,
      trimmedSec: (left.length - length) / audio.sampleRate,
      leadSec: info.trim === false ? 0 : Math.min(0.02, range.start / audio.sampleRate),
      wave: wavePeaks(channels, 120),
      bpm: tempo ? Math.round(tempo.bpm * 100) / 100 : null,
      musicalKey: key,
    },
    info.name,
  );
}

export const barSeconds = (bpm: number | null) => (bpm && bpm > 0 ? 240 / bpm : null);

/** Whole bars that fit in the beat. */
export function barsIn(beat: Beat) {
  const bar = barSeconds(beat.bpm);
  return bar ? Math.max(1, Math.floor((beat.durationSec + 0.05) / bar)) : 0;
}

/** The loop region in seconds, or null when the beat plays through once. */
export function loopSeconds(beat: Beat, loop: LoopChoice): { start: number; end: number; bars: number; startBar: number } | null {
  const bar = barSeconds(beat.bpm);
  const total = barsIn(beat);
  if (!bar || loop.bars === 0 || total < 1) return null;
  const bars = Math.min(loop.bars, total);
  const startBar = Math.max(0, Math.min(loop.startBar, total - bars));
  // Bar one begins after the short lead-in that trimming leaves, not at the very first sample.
  const lead = Math.min(beat.leadSec ?? 0, Math.max(0, beat.durationSec - (startBar + bars) * bar));
  return { start: lead + startBar * bar, end: Math.min(beat.durationSec, lead + (startBar + bars) * bar), bars, startBar };
}

// ---------- Takes ----------

/** Straight-line resampling, for the rare case a take was recorded at a different rate from its beat. */
function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (Math.abs(from - to) < 1) return x;
  const out = new Float32Array(Math.round((x.length * to) / from));
  const step = from / to;
  for (let i = 0; i < out.length; i++) {
    const at = i * step;
    const lo = Math.floor(at);
    out[i] = x[lo] + ((x[Math.min(x.length - 1, lo + 1)] ?? 0) - x[lo]) * (at - lo);
  }
  return out;
}

/**
 * Lines a recording up with the beat and stores it as a take. `punchAtSec` keeps everything
 * before that point from the previous take.
 */
export async function saveTake(projectId: string, recorded: RecordedTake, options: { latencyMs: number; origin: Take['origin']; punchAtSec?: number }): Promise<Take | null> {
  const project = getProject(projectId);
  if (!project) return null;
  const rate = project.beat.sampleRate;
  let mono = resample(recorded.mono, recorded.sampleRate, rate);
  const late = Math.round((options.latencyMs / 1000) * rate);
  let phaseSec = recorded.phaseSec;
  const loop = loopSeconds(project.beat, project.loop);
  if (phaseSec > 0.001 && loop) {
    // Held from listening: it already starts mid-loop, so move its place in the loop back instead.
    const span = loop.end - loop.start;
    phaseSec = (((phaseSec - options.latencyMs / 1000) % span) + span) % span;
  } else {
    // What was sung against bar one arrived late by the round trip; take that off the front.
    mono = mono.subarray(Math.min(late, mono.length));
    phaseSec = 0;
  }
  let origin = options.origin;
  const previous = activeTake(project);
  if (options.punchAtSec && previous && previous.phaseSec < 0.001) {
    const before = (await loadPcm(previous.key)).channels[0];
    const at = Math.round(options.punchAtSec * rate);
    const fade = Math.round(rate * 0.01);
    const joined = new Float32Array(Math.max(mono.length, Math.min(before.length, at)));
    joined.set(mono);
    for (let i = 0; i < Math.min(at, before.length); i++) {
      const k = i > at - fade ? (at - i) / fade : 1;
      joined[i] = before[i] * k + (i < mono.length ? mono[i] * (1 - k) : 0);
    }
    mono = joined;
    origin = 'punched';
  }
  if (mono.length < rate * 0.5) return null;
  const take: Take = {
    id: newId(),
    number: project.takes.reduce((n, t) => Math.max(n, t.number), 0) + 1,
    createdAt: Date.now(),
    key: `take-${newId()}`,
    durationSec: mono.length / rate,
    sampleRate: rate,
    channels: 1,
    phaseSec,
    loop: project.loop,
    wave: wavePeaks([mono], 120),
    peakDb: toDb(peakOf([mono])),
    clipped: recorded.clipped,
    origin,
    voice: null,
  };
  await savePcm(take.key, [mono], rate);
  addTake(projectId, take);
  return take;
}

// ---------- Rendering ----------

export type MixOptions = { include?: RenderInput['include']; targetLufs?: number | null; withTake?: boolean };

/** Everything the renderer needs for a project, with its audio loaded. */
export async function renderInput(project: Project, options: MixOptions = {}): Promise<RenderInput> {
  const beat = await loadPcm(project.beat.key);
  const take = options.withTake === false ? null : activeTake(project);
  const rate = beat.sampleRate;
  const bar = barSeconds(project.beat.bpm);
  const loop = take ? loopSeconds(project.beat, take.loop) : null;
  return {
    sampleRate: rate,
    beat: beat.channels,
    loop: loop ? { start: Math.round(loop.start * rate), end: Math.round(loop.end * rate) } : null,
    take: take ? { mono: (await loadPcm(take.key)).channels[0], phase: Math.round(take.phaseSec * rate) } : null,
    polish: project.polish,
    master: project.master,
    overrides: project.overrides,
    space: project.space,
    include: options.include,
    barFrames: bar ? Math.round(bar * rate) : undefined,
    targetLufs: options.targetLufs,
    voice: take?.voice ?? undefined,
    stageKeys: {
      vocal: JSON.stringify([take?.id, take?.loop, project.beat.bpm, project.polish.style, project.polish.double, project.overrides.vocal ?? null, project.space?.vocal ?? null, project.space?.roomCut ?? null]),
      beat: JSON.stringify([project.beat.key, take?.id ?? null, take?.loop ?? null, project.beat.bpm, project.overrides.beat ?? null, project.space?.beat ?? null]),
    },
  };
}

/** Changes whenever something that affects the sound changes. */
export function mixSignature(project: Project, options: MixOptions = {}) {
  const take = options.withTake === false ? null : activeTake(project);
  return JSON.stringify([project.id, project.beat.key, project.beat.bpm, take?.id ?? null, take?.loop ?? null, project.polish, project.master, project.overrides, project.space ?? null, options.include ?? 'mix', options.targetLufs === undefined ? 'style' : options.targetLufs]);
}

const mixes = new Map<string, Promise<RenderOutput>>();
// The processed vocal and beat from the last render, so that changing only the vocal level
// or the master does not redo them.
const stages: StageCache = {};
let renderQueue: Promise<unknown> = Promise.resolve();

/** The mastered mix for a project. Repeated calls with the same settings share one render. */
export function getMix(project: Project, options: MixOptions = {}, onStage?: (stage: string) => void): Promise<RenderOutput> {
  const signature = mixSignature(project, options);
  const hit = mixes.get(signature);
  if (hit) return hit;
  // One render at a time: they share the stage cache, and two at once would only slow each other.
  const work = renderQueue.then(() => renderInput(project, options)).then((input) => renderMix(input, onStage, stages));
  renderQueue = work.catch(() => {});
  mixes.set(signature, work);
  while (mixes.size > 4) mixes.delete(mixes.keys().next().value as string);
  work.then(
    (out) => {
      if (options.include || options.targetLufs !== undefined || options.withTake === false) return;
      // Keep what was measured, so lists and later renders do not have to work it out again.
      const take = activeTake(project);
      const stats = { lufs: Math.round(out.lufs * 10) / 10, truePeakDb: Math.round(out.truePeakDb * 10) / 10, durationSec: out.durationSec };
      patchProject(
        project.id,
        (p) => ({
          stats: p.stats && p.stats.lufs === stats.lufs && p.stats.truePeakDb === stats.truePeakDb && p.stats.durationSec === stats.durationSec ? p.stats : stats,
          takes: take && out.voice && !take.voice ? p.takes.map((t) => (t.id === take.id ? { ...t, voice: out.voice } : t)) : p.takes,
        }),
        false,
      );
    },
    () => mixes.delete(signature),
  );
  return work;
}

export async function getRaw(project: Project): Promise<Stereo> {
  return renderRaw(await renderInput(project));
}

export type MixState = { mix: RenderOutput | null; busy: boolean; stage: string; error: string | null };

/** Keeps a project's mix up to date as its settings change, holding on to the last one while the next renders. */
export function useMix(project: Project | null, options: MixOptions = {}): MixState {
  const [state, setState] = useState<MixState>({ mix: null, busy: !!project, stage: '', error: null });
  const signature = project ? mixSignature(project, options) : '';
  const latest = useRef(signature);
  latest.current = signature;
  useEffect(() => {
    if (!project) {
      setState({ mix: null, busy: false, stage: '', error: null });
      return;
    }
    setState((s) => ({ ...s, busy: true, error: null }));
    // A short pause lets a slider settle before the work starts.
    const timer = setTimeout(() => {
      getMix(project, options, (stage) => latest.current === signature && setState((s) => ({ ...s, stage }))).then(
        (mix) => latest.current === signature && setState({ mix, busy: false, stage: '', error: null }),
        (e) => latest.current === signature && setState((s) => ({ ...s, busy: false, stage: '', error: e instanceof Error ? e.message : 'Could not render the mix.' })),
      );
    }, 120);
    return () => clearTimeout(timer);
    // The signature stands in for the project and options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return state;
}
