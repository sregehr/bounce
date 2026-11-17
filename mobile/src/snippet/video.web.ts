// Makes the share video for a snippet: the card from the Snippet screen, animated, with the audio.
// The browser records it in real time, so a 20-second snippet takes 20 seconds to make.
import { C, F } from '@/ui/theme';

import { lineAt, type TimedLine } from './lyricTiming';

export type SnippetVideo = { blob: Blob; extension: 'mp4' | 'webm' };
/** `lines` are the song's lyric lines with the moment each shows; when there are any they take the caption's place. */
export type SnippetCard = { title: string; artist: string; caption: string | null; credit: string | null; peaks: number[]; coverUrl: string | null; lines?: TimedLine[] | null };

export type SnippetShape = 'tall' | 'square' | 'wide';

/**
 * The frame for each place a snippet gets posted, and where things sit in it. Tall is for
 * Reels, TikTok, Shorts and Stories, whose own buttons and captions cover the bottom of the
 * frame, so the words stop well short of it. Square is for feeds; wide is for YouTube and X.
 */
const SHAPES: Record<SnippetShape, { w: number; h: number; top: number; title: number; titleLines: number; wave: number; waveTall: number; foot: number; captionLines: number }> = {
  tall: { w: 720, h: 1280, top: 136, title: 96, titleLines: 2, wave: 640, waveTall: 200, foot: 210, captionLines: 3 },
  square: { w: 1080, h: 1080, top: 96, title: 88, titleLines: 2, wave: 430, waveTall: 180, foot: 96, captionLines: 3 },
  wide: { w: 1280, h: 720, top: 56, title: 72, titleLines: 1, wave: 270, waveTall: 110, foot: 64, captionLines: 2 },
};

function pickType(): { mime: string; extension: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const [mime, extension] of [
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm', 'webm'],
  ] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, extension };
  }
  return null;
}

export const videoSupported = () => pickType() !== null;

function wrap(g: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width <= max || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
    if (out.length === lines) break;
  }
  if (line && out.length < lines) out.push(line);
  return out;
}

async function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** How dark the photo is made behind the words and the waveform, top to bottom. The Snippet screen's card uses the same. */
export const SCRIM: [number, number][] = [
  [0, 0.8],
  [0.4, 0.55],
  [0.62, 0.6],
  [1, 0.88],
];

/** How long a lyric line takes to come up. */
const LINE_IN_SEC = 0.18;

/**
 * Fits words into the space the caption has: at most `lines` lines of the frame's width. A line
 * too long for that at full size is set smaller, and only cut short, with an ellipsis, if it
 * still does not fit. So the words never run down into the part of a tall frame that an app's
 * own buttons cover.
 */
function fitWords(g: CanvasRenderingContext2D, text: string, max: number, lines: number): { size: number; rows: string[] } {
  for (const size of [44, 38, 32]) {
    g.font = `${size}px ${F.display}, sans-serif`;
    const rows = wrap(g, text, max, lines + 1);
    if (rows.length <= lines) return { size, rows };
    if (size === 32) {
      const kept = rows.slice(0, lines);
      let last = kept[lines - 1];
      while (last.length > 1 && g.measureText(`${last}…`).width > max) last = last.slice(0, -1);
      kept[lines - 1] = `${last.trimEnd()}…`;
      return { size, rows: kept };
    }
  }
  return { size: 32, rows: [] };
}

function draw(g: CanvasRenderingContext2D, card: SnippetCard, cover: HTMLImageElement | null, progress: number, shape: SnippetShape, seconds = 0) {
  const f = SHAPES[shape];
  const W = f.w, H = f.h;
  const pad = 56;
  let y = f.top;
  if (cover) {
    // The song's photo fills the frame, darkened so light words and bars read on any picture.
    const scale = Math.max(W / cover.width, H / cover.height);
    g.drawImage(cover, (W - cover.width * scale) / 2, (H - cover.height * scale) * 0.3, cover.width * scale, cover.height * scale);
    const shade = g.createLinearGradient(0, 0, 0, H);
    for (const [at, dark] of SCRIM) shade.addColorStop(at, `rgba(18,18,18,${dark})`);
    g.fillStyle = shade;
    g.fillRect(0, 0, W, H);
  } else {
    g.fillStyle = C.accent;
    g.fillRect(0, 0, W, H);
  }
  g.fillStyle = cover ? C.text : C.bg;
  g.textBaseline = 'top';
  g.font = `${f.title}px ${F.display}, sans-serif`;
  for (const line of wrap(g, card.title, W - pad * 2, f.titleLines)) {
    g.fillText(line, pad, y);
    y += f.title + 4;
  }
  g.font = `32px ${F.semi}, sans-serif`;
  g.fillText(card.artist, pad, y + 8);

  // Waveform: bars already played are solid, the rest faded.
  const bars = card.peaks.length;
  const top = f.wave, height = f.waveTall;
  const step = (W - pad * 2) / bars;
  for (let i = 0; i < bars; i++) {
    const h = Math.max(8, Math.sqrt(card.peaks[i]) * height);
    g.globalAlpha = i / bars <= progress ? 1 : 0.35;
    g.beginPath();
    g.roundRect(pad + i * step, top + (height - h) / 2, Math.max(3, step * 0.6), h, 3);
    g.fill();
  }
  g.globalAlpha = 1;

  let bottom = H - f.foot;
  if (card.credit) {
    g.font = `26px ${F.semi}, sans-serif`;
    g.fillText(card.credit.toUpperCase(), pad, bottom - 26);
    bottom -= 60;
  }
  // The lyric line being sung, or else the one caption, in the same place: above the credit and clear of the foot of the frame.
  const line = card.lines?.length ? lineAt(card.lines, seconds) : null;
  const words = card.lines?.length ? (line?.text ?? null) : card.caption;
  if (words) {
    const { size, rows } = fitWords(g, words, W - pad * 2, f.captionLines);
    const box = wordsBox(shape, rows.length, size, !!card.credit);
    // A new line eases in rather than snapping on.
    if (line) g.globalAlpha = Math.max(0, Math.min(1, (seconds - line.at) / LINE_IN_SEC));
    rows.forEach((row, i) => g.fillText(row, pad, box.top + i * box.step));
    g.globalAlpha = 1;
  }
}

/**
 * Where the words (a lyric line or the caption) sit in a frame: `rows` rows of `size`-pixel type,
 * stacked up from just above the credit. `safeBottom` is the lowest the words may reach: in the
 * tall shape everything under it is covered by the buttons and captions of the app it is posted to.
 */
export function wordsBox(shape: SnippetShape, rows: number, size: number, credit: boolean) {
  const f = SHAPES[shape];
  const step = Math.round(size * 1.23);
  const bottom = f.h - f.foot - (credit ? 60 : 0);
  return { top: bottom - rows * step, bottom, step, safeBottom: f.h - f.foot, wave: f.wave + f.waveTall, maxRows: f.captionLines };
}

/** Records the card with its audio. `onProgress` is called with the seconds left. */
export async function makeSnippetVideo(audio: { channels: Float32Array[]; sampleRate: number }, card: SnippetCard, onProgress: (secondsLeft: number) => void, shape: SnippetShape = 'tall'): Promise<SnippetVideo> {
  const type = pickType();
  if (!type) throw new Error('This browser cannot record video. The audio can still be saved.');
  const canvas = document.createElement('canvas');
  canvas.width = SHAPES[shape].w;
  canvas.height = SHAPES[shape].h;
  const g = canvas.getContext('2d')!;
  const cover = await loadImage(card.coverUrl);
  draw(g, card, cover, 0, shape);

  const ctx = new AudioContext({ sampleRate: audio.sampleRate });
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const parts: Blob[] = [];
  // Whatever happens, the audio clock made for this video is closed again: browsers only allow a few.
  try {
    const buffer = ctx.createBuffer(Math.min(2, audio.channels.length), audio.channels[0].length, audio.sampleRate);
    for (let i = 0; i < buffer.numberOfChannels; i++) buffer.copyToChannel(audio.channels[i] as Float32Array<ArrayBuffer>, i);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);

    stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: shape === 'tall' ? 4_000_000 : 5_000_000, audioBitsPerSecond: 256_000 });
    recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('Recording the video failed.'));
    });

    const duration = buffer.duration;
    await ctx.resume();
    recorder.start(250);
    const began = ctx.currentTime + 0.05;
    // The video ends when the audio does, by the audio's own clock, so a tab that was put in
    // the background for a while still gets the whole snippet.
    const played = new Promise<void>((resolve) => (src.onended = () => resolve()));
    src.start(began);
    // A timer rather than animation frames, so it keeps going if the tab is in the background.
    timer = setInterval(() => {
      const t = Math.max(0, ctx.currentTime - began);
      draw(g, card, cover, Math.min(1, t / duration), shape, t);
      onProgress(Math.max(0, Math.ceil(duration - t)));
    }, 33);
    await Promise.race([played, new Promise((r) => setTimeout(r, duration * 1000 + 15000))]);
    await new Promise((r) => setTimeout(r, 200));
    recorder.stop();
    await stopped;
  } finally {
    if (timer) clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  }
  return { blob: new Blob(parts, { type: type.mime.split(';')[0] }), extension: type.extension };
}
