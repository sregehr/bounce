import { detectTempo } from '../src/dsp/analysis';
import { integratedLufs, peakOf, toDb } from '../src/dsp/core';
import { DEMO, makeDemoBeat } from '../src/dsp/demoBeat';
import { DEFAULT_MASTER, DEFAULT_POLISH, MASTER_STYLES, VOCAL_STYLES, summarise } from '../src/dsp/presets';
import { renderMix, renderRaw, songLength, type RenderInput } from '../src/dsp/render';

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
}
const finite = (channels: Float32Array[]) => channels.every((ch) => ch.every((v) => Number.isFinite(v)));

const sr = DEMO.sampleRate;
const beat = makeDemoBeat();
const bar = Math.round((240 / DEMO.bpm) * sr);

// A stand-in vocal: syllable-like bursts of a buzzy tone with hiss on top and background noise throughout.
const voice = new Float32Array(Math.round(sr * 13.3));
let seed = 3;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
for (let i = 0; i < voice.length; i++) {
  const t = i / sr;
  const syllable = Math.max(0, Math.sin(2 * Math.PI * 3.1 * t)) * (Math.floor(t / 2.6) % 2 === 0 ? 1 : 0.15);
  const pitch = 140 + 30 * Math.sin(t * 1.7);
  let tone = 0;
  for (let h = 1; h <= 12; h++) tone += Math.sin(2 * Math.PI * pitch * h * t) / h;
  voice[i] = tone * 0.12 * syllable + rand() * 0.03 * syllable + rand() * 0.004;
}

const base: RenderInput = {
  sampleRate: sr,
  beat,
  loop: { start: 0, end: bar * 4 },
  take: { mono: voice, phase: 0 },
  polish: DEFAULT_POLISH,
  master: DEFAULT_MASTER,
  barFrames: bar,
};

const run = async () => {
  check('song length', songLength(base) === bar * 6, `${songLength(base) / bar} bars for a ${(voice.length / sr).toFixed(1)} s take`);
  const raw = renderRaw(base);
  check('raw mix', finite(raw) && peakOf(raw) <= 0.981 && raw[0].length === bar * 6, `peak ${toDb(peakOf(raw)).toFixed(1)} dB`);

  let t = Date.now();
  const stages: string[] = [];
  const mix = await renderMix(base, (s) => stages.push(s));
  check('polished mix', finite(mix.channels) && mix.truePeakDb <= -0.95 && Math.abs(mix.durationSec - (bar * 6) / sr) < 0.001, `${mix.lufs.toFixed(1)} LUFS, true peak ${mix.truePeakDb.toFixed(2)} dB, ${Date.now() - t} ms, stages: ${stages.length}`);
  check('vocal chain fitted', !!mix.chains.vocal && mix.did.noiseReduced, `${JSON.stringify(summarise(mix.chains.vocal!))}, vocal gain ${mix.did.vocalGainDb.toFixed(1)} dB, body ${mix.voice?.bodyDb.toFixed(1)} dB`);
  check('master note', mix.note.length > 20, mix.note);
  // The loop must still be in time after rendering: the tempo of the output matches the beat.
  const tempo = detectTempo((await renderMix({ ...base, include: 'instrumental' })).channels, sr);
  check('mix keeps tempo', !!tempo && Math.abs(tempo.bpm - DEMO.bpm) < 0.3, `${tempo?.bpm.toFixed(2)} BPM`);

  for (const style of MASTER_STYLES) {
    t = Date.now();
    const out = await renderMix({ ...base, master: { ...DEFAULT_MASTER, style, amount: 100 } });
    check(`master ${style}`, finite(out.channels) && out.truePeakDb <= -0.95 && out.lufs > -16 && out.lufs < -6, `${out.lufs.toFixed(1)} LUFS, peak ${out.truePeakDb.toFixed(2)} dB, limiter ${out.did.limiterDb.toFixed(1)} dB, ${Date.now() - t} ms`);
  }
  const loud = await renderMix({ ...base, master: { ...DEFAULT_MASTER, style: 'Loud', amount: 100 } });
  const soft = await renderMix({ ...base, master: { ...DEFAULT_MASTER, style: 'Loud', amount: 0 } });
  check('intensity changes loudness', loud.lufs > soft.lufs + 2, `0% ${soft.lufs.toFixed(1)} LUFS, 100% ${loud.lufs.toFixed(1)} LUFS`);

  for (const style of VOCAL_STYLES) {
    const out = await renderMix({ ...base, polish: { ...DEFAULT_POLISH, style } });
    check(`vocal ${style}`, finite(out.channels), `vocal gain ${out.did.vocalGainDb.toFixed(1)} dB, comp ${summarise(out.chains.vocal!).comp}`);
  }
  const up = await renderMix({ ...base, polish: { ...DEFAULT_POLISH, vocalLevel: 100 }, include: 'vocals' });
  const down = await renderMix({ ...base, polish: { ...DEFAULT_POLISH, vocalLevel: 20 }, include: 'vocals' });
  check('vocal level slider', up.did.vocalGainDb > down.did.vocalGainDb + 15, `${down.did.vocalGainDb.toFixed(1)} → ${up.did.vocalGainDb.toFixed(1)} dB`);
  const muted = await renderMix({ ...base, polish: { ...DEFAULT_POLISH, vocalLevel: 0 }, include: 'vocals' });
  check('vocal level at 0 is silence', peakOf(muted.channels) === 0, `peak ${peakOf(muted.channels)}`);
  // A quiet take needs all the lift the automatic balance allows; the slider must still work on top of it.
  const quiet = { ...base, take: { mono: voice.map((v) => v * 0.01), phase: 0 } };
  const quietUp = await renderMix({ ...quiet, polish: { ...DEFAULT_POLISH, vocalLevel: 100 }, include: 'vocals' });
  const quietDown = await renderMix({ ...quiet, polish: { ...DEFAULT_POLISH, vocalLevel: 20 }, include: 'vocals' });
  check('vocal level slider on a quiet take', quietUp.did.vocalGainDb > quietDown.did.vocalGainDb + 15, `${quietDown.did.vocalGainDb.toFixed(1)} → ${quietUp.did.vocalGainDb.toFixed(1)} dB`);
  const dbl = await renderMix({ ...base, include: 'vocals' });
  const single = await renderMix({ ...base, polish: { ...DEFAULT_POLISH, double: false, style: 'Gritty' }, include: 'vocals' });
  const width = (c: Float32Array[]) => { let d = 0, s = 0; for (let i = 0; i < c[0].length; i += 7) { d += (c[0][i] - c[1][i]) ** 2; s += (c[0][i] + c[1][i]) ** 2; } return d / (s || 1); };
  check('double track widens', width(dbl.channels) > width(single.channels) * 2, `side/mid ${width(single.channels).toFixed(4)} → ${width(dbl.channels).toFixed(4)}`);

  // Reverb and echo, set by hand for each part of the mix.
  const energy = (c: Float32Array[], from = 0, to = c[0].length) => { let e = 0; for (let i = from; i < to; i++) e += c[0][i] ** 2 + c[1][i] ** 2; return e; };
  const differs = (a: Float32Array[], b: Float32Array[]) => { let d = 0; for (let i = 0; i < a[0].length; i += 3) d += (a[0][i] - b[0][i]) ** 2; return d / (energy(a) || 1); };
  const stem = (space: RenderInput['space']) => renderMix({ ...base, polish: { ...DEFAULT_POLISH, double: false }, space, include: 'vocals' });
  const dryV = await stem({ vocal: { reverb: 0 } });
  const wetV = await stem({ vocal: { reverb: 100 } });
  const styleV = await stem(undefined);
  const fromDry = (o: { channels: Float32Array[] }) => differs(o.channels, dryV.channels);
  check('vocal reverb slider', fromDry(wetV) > fromDry(styleV) * 4 && fromDry(styleV) > 0, `differs from dry: style ${fromDry(styleV).toExponential(1)}, full ${fromDry(wetV).toExponential(1)}`);
  const echoV = await stem({ vocal: { reverb: 0, echo: 80 } });
  check('vocal echo', finite(echoV.channels) && differs(echoV.channels, dryV.channels) > 0.01, `differs from dry by ${differs(echoV.channels, dryV.channels).toFixed(3)}`);
  const noCut = await stem({ vocal: { reverb: 0 }, roomCut: 0 });
  const hardCut = await stem({ vocal: { reverb: 0 }, roomCut: 100 });
  // Between the stand-in vocal's syllables there is only background noise: that is what the cut turns down.
  const between = (c: Float32Array[]) => { let e = 0; for (let i = 0; i < voice.length; i++) if (Math.sin((2 * Math.PI * 3.1 * i) / sr) < -0.6) e += c[0][i] ** 2; return e; };
  check('room cut', !noCut.did.noiseReduced && between(hardCut.channels) < between(dryV.channels) && between(dryV.channels) < between(noCut.channels) * 0.7, `noise between syllables: off ${between(noCut.channels).toExponential(1)}, auto ${between(dryV.channels).toExponential(1)}, full ${between(hardCut.channels).toExponential(1)}`);
  const plainBeat = await renderMix({ ...base, include: 'instrumental', targetLufs: null });
  const wetBeat = await renderMix({ ...base, include: 'instrumental', targetLufs: null, space: { beat: { reverb: 60, echo: 40 } } });
  const wetAll = await renderMix({ ...base, include: 'instrumental', targetLufs: null, space: { master: { reverb: 60 } } });
  check('beat and master reverb', finite(wetBeat.channels) && finite(wetAll.channels) && differs(wetBeat.channels, plainBeat.channels) > 0.001 && differs(wetAll.channels, plainBeat.channels) > 0.0003 && wetBeat.truePeakDb <= -0.95, `beat differs by ${differs(wetBeat.channels, plainBeat.channels).toFixed(4)}, master by ${differs(wetAll.channels, plainBeat.channels).toFixed(4)}`);

  const inst = await renderMix({ ...base, include: 'instrumental' });
  check('instrumental', finite(inst.channels) && inst.chains.vocal === null, `${inst.lufs.toFixed(1)} LUFS`);
  const stream = await renderMix({ ...base, targetLufs: -14 });
  check('export at −14 LUFS', Math.abs(stream.lufs + 14) < 0.6, `${stream.lufs.toFixed(2)} LUFS`);
  const asIs = await renderMix({ ...base, targetLufs: null });
  check('export without a target', finite(asIs.channels) && asIs.truePeakDb <= -0.95, `${asIs.lufs.toFixed(1)} LUFS`);

  // Beat only, played through once.
  const beatOnly = await renderMix({ ...base, take: null, loop: null });
  check('master the beat alone', beatOnly.channels[0].length === beat[0].length && Math.abs(integratedLufs(beatOnly.channels, sr) - beatOnly.lufs) < 0.01, `${beatOnly.lufs.toFixed(1)} LUFS, ${beatOnly.durationSec.toFixed(2)} s`);
  // A take that starts part-way through the loop (kept from the last 60 seconds).
  const kept = await renderMix({ ...base, take: { mono: voice, phase: bar * 2 + 1234 } });
  check('take with a loop phase', finite(kept.channels), `${kept.durationSec.toFixed(2)} s`);
  // Silence in, silence out, and no crash.
  const silent = await renderMix({ ...base, take: { mono: new Float32Array(sr * 3), phase: 0 } });
  check('silent take', finite(silent.channels), `${silent.lufs.toFixed(1)} LUFS, vocal gain ${silent.did.vocalGainDb}`);
  const mono = await renderMix({ ...base, beat: [beat[0]] });
  check('mono beat', finite(mono.channels), `${mono.lufs.toFixed(1)} LUFS`);

  // A three-minute song, for timing.
  const long = new Float32Array(sr * 180);
  for (let i = 0; i < long.length; i++) long[i] = voice[i % voice.length];
  t = Date.now();
  const big = await renderMix({ ...base, take: { mono: long, phase: 0 } });
  check('three-minute song', finite(big.channels), `rendered in ${Date.now() - t} ms, ${big.lufs.toFixed(1)} LUFS`);

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
};
run();
