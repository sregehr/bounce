import { detectKey, detectTempo, measureVoice, strongestStretch, tonalBalance } from '../src/dsp/analysis';
import { finalise, integratedLufs, limit, peakOf, reduceNoise, toDb, trimRange, truePeakDb, wavePeaks, rmsDb } from '../src/dsp/core';
import { DEMO, makeDemoBeat } from '../src/dsp/demoBeat';
import { encodeWav, parseWav } from '../src/dsp/wav';
import { analyseClicks, makeClickTrain } from '../src/dsp/latency';

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const sine = (freq: number, amp: number, seconds: number, sr: number) => {
  const x = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
};

const sr = 48000;
// EBU reference: a 1 kHz sine at −23 dBFS in both channels reads −23 LUFS.
const ref = sine(1000, Math.pow(10, -23 / 20), 10, sr);
const l = integratedLufs([ref, ref.slice()], sr);
check('LUFS reference tone', near(l, -23, 0.2), `${l.toFixed(2)} LUFS (want −23)`);
check('true peak of a sine', near(truePeakDb([sine(997, 0.5, 1, sr)]), -6.02, 0.2), `${truePeakDb([sine(997, 0.5, 1, sr)]).toFixed(2)} dB (want −6.02)`);

const t0 = Date.now();
const [L, R] = makeDemoBeat();
check('demo beat length', near(L.length / DEMO.sampleRate, (240 / DEMO.bpm) * DEMO.bars, 0.01), `${(L.length / DEMO.sampleRate).toFixed(2)} s, built in ${Date.now() - t0} ms`);
check('demo beat peak', near(toDb(peakOf([L, R])), -3, 0.1), `${toDb(peakOf([L, R])).toFixed(2)} dB`);

const t1 = Date.now();
const tempo = detectTempo([L, R], DEMO.sampleRate);
check('tempo', !!tempo && near(tempo.bpm, DEMO.bpm, 0.15), `${tempo?.bpm.toFixed(2)} BPM in ${Date.now() - t1} ms (want ${DEMO.bpm}), confidence ${tempo?.confidence.toFixed(2)}`);
const t2 = Date.now();
const key = detectKey([L, R], DEMO.sampleRate);
check('key', key?.name === DEMO.key, `${key?.name} in ${Date.now() - t2} ms (want ${DEMO.key}), confidence ${key?.confidence.toFixed(2)}`);

// Tempo at a few other speeds, using a bare click-and-kick pattern.
for (const bpm of [74, 86.5, 120, 140]) {
  const beat = 60 / bpm, rate = 44100;
  const x = new Float32Array(Math.round(rate * beat * 64));
  for (let b = 0; b < 64; b++) {
    const at = Math.round(b * beat * rate);
    for (let i = 0; i < 4000 && at + i < x.length; i++) x[at + i] += Math.sin((2 * Math.PI * (b % 2 ? 190 : 60) * i) / rate) * Math.exp(-i / 700) * 0.8;
    const off = Math.round((b + 0.5) * beat * rate);
    for (let i = 0; i < 800 && off + i < x.length; i++) x[off + i] += (((i * 7919) % 13) / 13 - 0.5) * Math.exp(-i / 150) * 0.3;
  }
  const got = detectTempo([x], rate);
  check(`tempo ${bpm}`, !!got && near(got.bpm, bpm, 0.2), `${got?.bpm.toFixed(2)} BPM`);
}

// Limiter: nothing may exceed the ceiling, and quiet material is left alone.
const hot = [L.map((v) => v * 4), R.map((v) => v * 4)];
const red = limit(hot, DEMO.sampleRate, -1, 80);
check('limiter ceiling', toDb(peakOf(hot)) <= -1 + 0.01, `peak ${toDb(peakOf(hot)).toFixed(2)} dB, reduction ${red.toFixed(1)} dB`);
const quiet = [L.map((v) => v * 0.2)];
const before = peakOf(quiet);
limit(quiet, DEMO.sampleRate, -1, 80);
check('limiter leaves quiet audio', near(peakOf(quiet), before, 1e-6), 'unchanged');

for (const target of [-14, -9]) {
  const mix = [L.slice(), R.slice()];
  const t = Date.now();
  const out = finalise(mix, DEMO.sampleRate, target, -1, 80);
  check(`master to ${target} LUFS`, near(out.lufs, target, 0.6) && out.truePeakDb <= -0.95, `${out.lufs.toFixed(2)} LUFS, true peak ${out.truePeakDb.toFixed(2)} dB, gain ${out.gainDb.toFixed(1)} dB, reduction ${out.reductionDb.toFixed(1)} dB, ${Date.now() - t} ms`);
}

// Trim: half a second of silence either side of the beat.
const pad = Math.round(DEMO.sampleRate * 0.5);
const padded = new Float32Array(L.length + pad * 2);
padded.set(L, pad);
const range = trimRange([padded], DEMO.sampleRate);
check('trim silence', near(range.start / DEMO.sampleRate, 0.48, 0.02) && range.end <= padded.length, `start ${(range.start / DEMO.sampleRate).toFixed(3)} s, end ${(range.end / DEMO.sampleRate).toFixed(2)} s of ${(padded.length / DEMO.sampleRate).toFixed(2)} s`);
check('trim all silence', trimRange([new Float32Array(1000)], 44100).end === 0, 'empty');

// A fake vocal: bursts of tone over steady hiss.
const voice = new Float32Array(sr * 8);
for (let i = 0; i < voice.length; i++) {
  const on = Math.floor(i / (sr * 0.5)) % 2 === 0;
  voice[i] = (((i * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01 + (on ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr) : 0);
}
const gapBefore = rmsDb([voice.subarray(sr * 0.75, sr * 0.95)]);
const cleaned = [voice.slice()];
const threshold = reduceNoise(cleaned, sr);
const gapAfter = rmsDb([cleaned[0].subarray(sr * 0.75, sr * 0.95)]);
const bodyAfter = rmsDb([cleaned[0].subarray(sr * 1.1, sr * 1.4)]);
check('noise reduction', gapAfter < gapBefore - 6 && near(bodyAfter, rmsDb([voice.subarray(sr * 1.1, sr * 1.4)]), 0.5), `gaps ${gapBefore.toFixed(1)} → ${gapAfter.toFixed(1)} dB, voice ${bodyAfter.toFixed(1)} dB, threshold ${threshold.toFixed(1)} dB`);
const stats = measureVoice([voice], sr);
check('voice stats', near(stats.bodyDb, -13.5, 1.5) && near(stats.activity, 0.5, 0.1), `body ${stats.bodyDb.toFixed(1)} dB, activity ${stats.activity.toFixed(2)}, sibilance ${stats.sibilanceDb.toFixed(1)} dB`);

const bal = tonalBalance([L, R], DEMO.sampleRate);
check('tonal balance', bal.low > bal.high, `low ${bal.low.toFixed(1)}, mid ${bal.mid.toFixed(1)}, high ${bal.high.toFixed(1)} dB`);

const quietThenLoud = new Float32Array(sr * 30);
for (let i = sr * 12; i < sr * 22; i++) quietThenLoud[i] = 0.5 * Math.sin((2 * Math.PI * 300 * i) / sr);
check('strongest stretch', near(strongestStretch([quietThenLoud], sr, 10, 1), 12, 0.01), `${strongestStretch([quietThenLoud], sr, 10, 1)} s (want 12)`);

const peaks = wavePeaks([L, R], 59);
check('wave peaks', peaks.length === 59 && Math.max(...peaks) === 1, `${peaks.length} bins`);
const wav = new DataView(encodeWav([L, R], DEMO.sampleRate, 24));
check('wav header', wav.getUint32(40, true) === L.length * 6 && wav.getUint16(34, true) === 24, `${wav.byteLength} bytes`);

const back = parseWav(encodeWav([L, R], DEMO.sampleRate, 24));
let worst = 0;
if (back) for (let i = 0; i < L.length; i += 97) worst = Math.max(worst, Math.abs(back.channels[0][i] - L[i]), Math.abs(back.channels[1][i] - R[i]));
check('wav round trip', !!back && back.sampleRate === DEMO.sampleRate && back.channels.length === 2 && back.channels[0].length === L.length && worst < 1e-6, `worst error ${worst.toExponential(1)}`);
check('wav rejects junk', parseWav(new ArrayBuffer(100)) === null, 'null');

// Latency: the click train delayed by 37.5 ms with some hiss should measure 37.5 ms.
const train = makeClickTrain(48000);
const delayFrames = Math.round(0.0375 * 48000);
const heard = new Float32Array(train.length + delayFrames);
for (let i = 0; i < train.length; i++) heard[i + delayFrames] = train[i] * 0.2;
for (let i = 0; i < heard.length; i++) heard[i] += (((i * 48271) % 2147483647) / 2147483647 - 0.5) * 0.002;
const lat = analyseClicks(heard, 48000);
check('latency test', lat.detected === 6 && lat.medianMs !== null && near(lat.medianMs, 37.5, 0.3), `${lat.medianMs?.toFixed(2)} ms from ${lat.detected} clicks`);
check('latency test in silence', analyseClicks(new Float32Array(train.length), 48000).medianMs === null, 'not detected');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
