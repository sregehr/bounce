// The three ways a beat gets into the library, shared by Home and onboarding.
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import { detectTempo } from '@/dsp/analysis';
import { DEMO, makeDemoBeat } from '@/dsp/demoBeat';
import { sniffAudio, SNIFF_BYTES } from '@/dsp/sniff';
import { decode } from '@/engine/engine';

import type { DemoSong } from './demoSongs';

import { importRefusal, MAX_IMPORT_SECONDS, TOO_LONG } from './importLimit';
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

// In a browser, "audio/*" makes iPhone offer the photo library and the video camera, because iOS has
// no audio-only recorder to offer. Naming the audio formats one by one sends it straight to Files.
// (No video containers such as .mp4 or .mov here: those bring the camera options back.)
const AUDIO_TYPES =
  Platform.OS === 'web'
    ? ['.wav', '.mp3', '.m4a', '.aac', '.aif', '.aiff', '.flac', '.ogg', '.caf', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/aiff', 'audio/x-aiff', 'audio/flac', 'audio/ogg']
    : ['audio/*'];

/** Lets the user pick an audio file. Resolves to null if they cancel. */
export async function importBeat() {
  // `base64: false`: left to itself, the browser picker reads the whole file into a string before handing it over.
  const picked = await DocumentPicker.getDocumentAsync({ type: AUDIO_TYPES, copyToCacheDirectory: true, multiple: false, base64: false });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];
  return importAudio(asset.name, asset.file ?? (() => fetch(asset.uri).then((r) => r.arrayBuffer())));
}

/**
 * Adds an audio file as a beat, however it arrived: picked from the file browser, or dropped onto the page.
 * Given the file itself, its length is checked from its header first, so one that is far too long is
 * turned away without being read into memory, let alone decoded.
 */
export async function importAudio(fileName: string, source: Blob | (() => Promise<ArrayBuffer>)) {
  if (typeof source !== 'function') {
    let said = null;
    try {
      const head = new Uint8Array(await source.slice(0, SNIFF_BYTES).arrayBuffer());
      const tail = source.size > SNIFF_BYTES ? new Uint8Array(await source.slice(Math.max(SNIFF_BYTES, source.size - SNIFF_BYTES)).arrayBuffer()) : undefined;
      said = sniffAudio(head, source.size, tail);
    } catch {
      // A file whose ends cannot be read is left for the decoder to refuse.
    }
    const refusal = said && importRefusal(said, source.size);
    if (refusal) throw new Error(refusal);
  }
  let pcm;
  try {
    pcm = await decode(await (typeof source === 'function' ? source() : source.arrayBuffer()));
  } catch {
    throw new Error(`"${fileName}" could not be read as audio. Try a WAV, MP3 or M4A file.`);
  }
  // The backstop, for formats whose header does not give the length.
  if (pcm.channels[0].length > pcm.sampleRate * MAX_IMPORT_SECONDS) throw new Error(TOO_LONG);
  const name = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  return addBeat(pcm, { source: 'import', label: fileName, name: freeName(name || nextBeatName()) });
}
