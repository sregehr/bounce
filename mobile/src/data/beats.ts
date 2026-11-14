// The three ways a beat gets into the library, shared by Home and onboarding.
import * as DocumentPicker from 'expo-document-picker';

import { detectTempo } from '@/dsp/analysis';
import { DEMO, makeDemoBeat } from '@/dsp/demoBeat';
import { decode } from '@/engine/engine';

import type { DemoSong } from './demoSongs';

import { addBeat } from './studio';
import { getLibrary, nextBeatName } from './store';

function freeName(base: string) {
  const used = new Set(getLibrary().projects.map((p) => p.name));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Makes the built-in demo beat. */
export async function addDemoBeat() {
  // Let the "working" state paint before the synthesis blocks for a moment.
  await new Promise((r) => setTimeout(r, 30));
  const [left, right] = makeDemoBeat();
  return addBeat({ channels: [left, right], sampleRate: DEMO.sampleRate }, { source: 'demo', label: 'Demo beat', name: freeName(DEMO.name), trim: false });
}

/** Fetches one of the bundled demo songs and adds it as a beat. */
export async function addDemoSong(song: DemoSong) {
  let pcm;
  try {
    const response = await fetch(`/demo/${song.id}.m4a`);
    if (!response.ok) throw new Error(String(response.status));
    pcm = await decode(await response.arrayBuffer());
  } catch {
    throw new Error(`"${song.title}" could not be loaded. Check your connection and try again.`);
  }
  // The exact tempo comes from the audio when it agrees with the tempo the song was written at
  // (or its half or double); otherwise the written tempo stands.
  const heard = detectTempo(pcm.channels, pcm.sampleRate)?.bpm;
  const factor = heard ? [1, 2, 0.5].find((f) => Math.abs((heard * f) / song.bpm - 1) < 0.03) : undefined;
  const bpm = heard && factor ? heard * factor : song.bpm;
  return addBeat(pcm, { source: 'demo', label: 'Demo song', name: freeName(song.title), trim: false, bpm });
}

/** Lets the user pick an audio file. Resolves to null if they cancel. */
export async function importBeat() {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];
  let pcm;
  try {
    const data = await (await fetch(asset.uri)).arrayBuffer();
    pcm = await decode(data);
  } catch {
    throw new Error(`"${asset.name}" could not be read as audio. Try a WAV, MP3 or M4A file.`);
  }
  if (pcm.channels[0].length > pcm.sampleRate * 60 * 12) throw new Error('That file is over 12 minutes long. Bounce is built for beats; trim it first.');
  const name = asset.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  return addBeat(pcm, { source: 'import', label: asset.name, name: freeName(name || nextBeatName()) });
}
