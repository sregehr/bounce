// Checks for the fixes that came out of the design review: the record button during a take,
// and reading a file's sample rate and length from its first bytes. Run from `mobile/`.
/// <reference types="node" />
import fs from 'node:fs';

import { decodeRate, sniffAudio, SNIFF_BYTES } from '../src/dsp/sniff';
import { encodeWav } from '../src/dsp/wav';
import { recordState } from '../src/ui/recordControl';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
}

// ---------- The record button ----------

check('with no microphone the button offers to connect one', recordState(false, 'idle') === 'off');
check('with a microphone it records', recordState(true, 'idle') === 'ready' && recordState(true, 'listening') === 'ready');
check('during a take it stops the take', recordState(true, 'recording') === 'recording');
check('and still does when the microphone has dropped mid-take', recordState(false, 'recording') === 'recording');

// ---------- What a file says about itself ----------

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => be32(n).reverse();
const zeros = (n: number) => new Array(n).fill(0);
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.05;

const wav = new Uint8Array(encodeWav([new Float32Array(16000 * 3)], 16000, 16));
const wavSays = sniffAudio(wav, wav.length);
check('a WAV gives its rate and length', wavSays.format === 'wav' && wavSays.sampleRate === 16000 && near(wavSays.seconds, 3), JSON.stringify(wavSays));
// Only the first bytes of a long WAV are needed: here an hour of CD audio, 635 MB, from its 44-byte header.
const hour = new Uint8Array(encodeWav([new Float32Array(1), new Float32Array(1)], 44100, 16).slice(0, 44));
new DataView(hour.buffer).setUint32(40, 3600 * 44100 * 4, true);
check('the length of a long WAV comes from its header alone', near(sniffAudio(hour, 44 + 3600 * 44100 * 4).seconds, 3600));
new DataView(hour.buffer).setUint32(40, 0, true);
check('a WAV whose length was never written is measured by its size', near(sniffAudio(hour, 44 + 3600 * 44100 * 4).seconds, 3600));

// FLAC: 48 kHz, stereo, 16-bit, 480000 samples.
const flac = bytes('fLaC', [0x80, 0, 0, 34], [16, 0, 16, 0], zeros(6), [0x0b, 0xb8, 0x02, 0xf0], be32(480000), zeros(16));
const flacSays = sniffAudio(flac, 5e6);
check('a FLAC gives its rate and length', flacSays.format === 'flac' && flacSays.sampleRate === 48000 && near(flacSays.seconds, 10), JSON.stringify(flacSays));

// MP3: two MPEG-1 layer III frames at 128 kbit/s and 44.1 kHz, behind an ID3 tag.
const frame = bytes([0xff, 0xfb, 0x90, 0x00], zeros(413));
const mp3 = bytes('ID3', [3, 0, 0, 0, 0, 0, 20], zeros(20), [...frame], [...frame]);
const mp3Says = sniffAudio(mp3, 30 + 320 * 125 * 800);
check('an MP3 gives its rate, and the least it can run for at its size', mp3Says.format === 'mp3' && mp3Says.sampleRate === 44100 && mp3Says.seconds === null && near(mp3Says.atLeastSeconds, 800), JSON.stringify(mp3Says));
const xing = bytes([0xff, 0xfb, 0x90, 0x00], zeros(32), 'Xing', be32(1), be32(10000), zeros(369), [...frame]);
check('an MP3 with a changing bitrate gives its length from its frame count', near(sniffAudio(xing, 4e6).seconds, (10000 * 1152) / 44100));

// AIFF: 44.1 kHz as an 80-bit number, 441000 frames.
const aiff = bytes('FORM', be32(0), 'AIFF', 'COMM', be32(18), [0, 2], be32(441000), [0, 16], [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
const aiffSays = sniffAudio(aiff, 2e6);
check('an AIFF gives its rate and length', aiffSays.sampleRate === 44100 && near(aiffSays.seconds, 10), JSON.stringify(aiffSays));

// Ogg Vorbis at 32 kHz; the last page says 320000 samples have played.
const ogg = bytes('OggS', zeros(24), '\x01vorbis', le32(0), [2], le32(32000), zeros(20));
const lastPage = bytes(zeros(10), 'OggS', [0, 4], le32(320000), le32(0), zeros(12));
const oggSays = sniffAudio(ogg, 1e6, lastPage);
check('an Ogg file gives its rate, and its length from its last page', oggSays.sampleRate === 32000 && near(oggSays.seconds, 10), JSON.stringify(oggSays));

// An M4A whose index is at the end of the file, as most are: found in the last bytes.
const m4aHead = bytes(be32(24), 'ftyp', 'M4A ', zeros(12), be32(1e6), 'mdat', zeros(64));
const m4aTail = bytes(zeros(8), 'mvhd', be32(0), be32(0), be32(0), be32(1000), be32(900000), zeros(40), 'mdhd', be32(0), be32(0), be32(0), be32(48000), be32(43200000), zeros(16));
const m4aSays = sniffAudio(m4aHead, 2e6, m4aTail);
check('an M4A gives its rate and length from the index at its end', m4aSays.format === 'm4a' && m4aSays.sampleRate === 48000 && near(m4aSays.seconds, 900), JSON.stringify(m4aSays));
const demo = new Uint8Array(fs.readFileSync('public/demo/a-little-more-sky.m4a'));
const demoSays = sniffAudio(demo.subarray(0, SNIFF_BYTES), demo.length, demo.subarray(Math.max(0, demo.length - SNIFF_BYTES)));
check('a real M4A reads the same way', demoSays.sampleRate === 44100 && near(demoSays.seconds, 45), JSON.stringify(demoSays));

const junk = sniffAudio(bytes('not audio at all', zeros(64)), 80);
check('anything else says nothing rather than guessing', junk.format === null && junk.sampleRate === null && junk.seconds === null && junk.atLeastSeconds === null);

check('a file is decoded at 44.1 or 48 kHz, whichever its own rate belongs with', decodeRate(44100) === 44100 && decodeRate(22050) === 44100 && decodeRate(88200) === 44100 && decodeRate(48000) === 48000 && decodeRate(96000) === 48000 && decodeRate(16000) === 48000);
check('and at 44.1 kHz when the file does not say', decodeRate(null) === 44100);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
