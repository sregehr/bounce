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
import { soundKey } from './match';
import { audioBudget, bytesOf, SizedCache } from './sizedCache';
import { type Layer, newId, type Beat, type LoopChoice, type Project, type Take } from './model';
import { activeTake, addTake, createProject, getProject, patchProject, stacks } from './store';

// ---------- Sound in and out of storage ----------

// Decoded files, kept by size rather than by count: each can be tens of megabytes.
const cache = new SizedCache<Pcm>(() => audioBudget().pcm);
const remember = (key: string, pcm: Pcm) => cache.set(key, pcm, bytesOf(pcm.channels));

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
export async function saveTake(projectId: string, recorded: RecordedTake, options: { latencyMs: number; origin: Take['origin']; punchAtSec?: number; layer?: Layer['role'] }): Promise<Take | null> {
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
    // What was sung against the beat arrived late by the round trip; take that off the front.
    // Held from listening to the whole beat, only the last minute is here, so silence goes in
    // front of it to put it back where it was sung.
    const shift = Math.round(phaseSec * rate) - late;
    if (shift > 0) {
      const placed = new Float32Array(shift + mono.length);
      placed.set(mono, shift);
      mono = placed;
    } else mono = mono.subarray(Math.min(-shift, mono.length));
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
  addTake(projectId, take, options.layer);
  return take;
}

// ---------- Layers and comping ----------

/** The layers that can really be stacked on a take: ones whose take still exists and lines up with it. */
export function layersOf(project: Project, lead: Take) {
  return (project.layers ?? []).flatMap((l) => {
    const take = project.takes.find((t) => t.id === l.takeId);
    return take && stacks(lead, take) ? [{ ...l, take }] : [];
  });
}

/** Which take each bar of the lead plays from, for the bars that have been swapped. */
export function compOf(project: Project, lead: Take) {
  return Object.entries(project.comp ?? {}).flatMap(([bar, id]) => {
    const take = project.takes.find((t) => t.id === id);
    return take && stacks(lead, take) && Number(bar) >= 0 ? [{ bar: Number(bar), take }] : [];
  });
}

/** Changes whenever the stack on a take does. */
const stackKey = (project: Project, lead: Take) => JSON.stringify([layersOf(project, lead).map((l) => [l.takeId, l.level, l.pan]), compOf(project, lead).map((c) => [c.bar, c.take.id])]);

/** The lead vocal: the picked take, with any swapped bars taken from the takes they were swapped to. */
async function leadOf(project: Project, lead: Take, barFrames: number): Promise<Float32Array> {
  const base = (await loadPcm(lead.key)).channels[0];
  const swaps = barFrames > 0 ? compOf(project, lead) : [];
  if (swaps.length === 0) return base;
  const length = Math.max(base.length, ...swaps.map((c) => Math.min(c.take.durationSec * lead.sampleRate, (c.bar + 1) * barFrames)));
  const out = new Float32Array(Math.round(length));
  out.set(base);
  const fade = Math.round(lead.sampleRate * 0.008);
  for (const { bar, take } of swaps) {
    const from = (await loadPcm(take.key)).channels[0];
    const start = bar * barFrames, end = Math.min(out.length, start + barFrames);
    for (let i = Math.max(0, start - fade); i < Math.min(out.length, end + fade); i++) {
      // A short crossfade either side of the bar line, so the join does not click.
      const k = i < start + fade ? (i - (start - fade)) / (fade * 2) : i > end - fade ? (end + fade - i) / (fade * 2) : 1;
      out[i] = out[i] * (1 - k) + (from[i] ?? 0) * k;
    }
  }
  return out;
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
    take: take ? { mono: await leadOf(project, take, bar ? Math.round(bar * rate) : 0), phase: Math.round(take.phaseSec * rate) } : null,
    layers: take ? await Promise.all(layersOf(project, take).map(async (l) => ({ mono: (await loadPcm(l.take.key)).channels[0], level: l.level, pan: l.pan }))) : undefined,
    polish: project.polish,
    master: project.master,
    overrides: project.overrides,
    space: project.space,
    include: options.include,
    barFrames: bar ? Math.round(bar * rate) : undefined,
    targetLufs: options.targetLufs,
    voice: take?.voice ?? undefined,
    stageKeys: {
      vocal: JSON.stringify([take?.id, take ? stackKey(project, take) : null, take?.loop, project.beat.bpm, project.polish.style, project.polish.double, project.overrides.vocal ?? null, project.space?.vocal ?? null, project.space?.roomCut ?? null]),
      beat: JSON.stringify([project.beat.key, take?.id ?? null, take?.loop ?? null, project.beat.bpm, project.overrides.beat ?? null, project.space?.beat ?? null]),
    },
  };
}

/** Changes whenever something that affects the sound changes. */
export function mixSignature(project: Project, options: MixOptions = {}) {
  const take = options.withTake === false ? null : activeTake(project);
  return JSON.stringify([project.id, project.beat.key, project.beat.bpm, take?.id ?? null, take ? stackKey(project, take) : null, take?.loop ?? null, project.polish, project.master, project.overrides, project.space ?? null, options.include ?? 'mix', options.targetLufs === undefined ? 'style' : options.targetLufs]);
}

// Finished mixes, kept by size: on a phone that is one mix of a long song, so switching between
// two versions of it renders again (quickly, from the stages below) rather than holding both.
const mixes = new SizedCache<Promise<RenderOutput>>(() => audioBudget().mixes);
// The processed vocal and beat from the last render, so that changing only the vocal level
// or the master does not redo them.
const stages: StageCache = {};
let renderQueue: Promise<unknown> = Promise.resolve();

/**
 * The mastered mix for a project. Repeated calls with the same settings share one render.
 * `keep: false` renders without holding on to the result, for a mix that is used once (an
 * exported stem): it is the caller's alone, and is freed when the caller lets go of it.
 */
export function getMix(project: Project, options: MixOptions = {}, onStage?: (stage: string) => void, { keep = true }: { keep?: boolean } = {}): Promise<RenderOutput> {
  const signature = mixSignature(project, options);
  const hit = mixes.get(signature);
  if (hit) return hit;
  // One render at a time: they share the stage cache, and two at once would only slow each other.
  const work = renderQueue.then(() => renderInput(project, options)).then((input) => renderMix(input, onStage, stages));
  // The queue only needs to know when this render is over; holding its result would keep a whole mix alive.
  renderQueue = work.then(
    () => {},
    () => {},
  );
  if (keep) mixes.set(signature, work, 0);
  work.then(
    (out) => {
      mixes.resize(signature, work, bytesOf(out.channels));
      if (options.include || options.targetLufs !== undefined || options.withTake === false) return;
      // Keep what was measured, so lists and later renders do not have to work it out again.
      const take = activeTake(project);
      const stats = { lufs: Math.round(out.lufs * 10) / 10, truePeakDb: Math.round(out.truePeakDb * 10) / 10, durationSec: out.durationSec };
      patchProject(
        project.id,
        (p) => ({
          stats: p.stats && p.stats.lufs === stats.lufs && p.stats.truePeakDb === stats.truePeakDb && p.stats.durationSec === stats.durationSec ? p.stats : stats,
          // Which sound these numbers are for: the project as it was rendered, which may have moved on since.
          statsOf: soundKey(project),
          takes: take && out.voice && !take.voice ? p.takes.map((t) => (t.id === take.id ? { ...t, voice: out.voice } : t)) : p.takes,
        }),
        false,
      );
    },
    () => mixes.delete(signature),
  );
  return work;
}

/**
 * Lets go of every finished mix except the one with these settings, before work that needs the
 * room (an export). What a screen is showing stays alive through that screen; this only stops
 * the cache from holding the others.
 */
export function keepOnlyMix(project: Project, options: MixOptions = {}) {
  mixes.keepOnly([mixSignature(project, options)]);
}

/**
 * Lets go of the processed vocal, the processed beat, or both. Each is a whole song long, and is
 * only kept to make the next render quick; the next render that needs one makes it again.
 */
export function dropStages(which: ('vocal' | 'beat')[] = ['vocal', 'beat']) {
  for (const stage of which) {
    stages[stage] = undefined;
    stages[`${stage}Key`] = undefined;
  }
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
