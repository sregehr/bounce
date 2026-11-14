// Makes the share video for a snippet: the card from the Snippet screen, animated, with the audio.
// The browser records it in real time, so a 20-second snippet takes 20 seconds to make.
import { C, F } from '@/ui/theme';

export type SnippetVideo = { blob: Blob; extension: 'mp4' | 'webm' };
export type SnippetCard = { title: string; artist: string; caption: string | null; credit: string | null; peaks: number[]; coverUrl: string | null };

const W = 720, H = 1280;

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

function draw(g: CanvasRenderingContext2D, card: SnippetCard, cover: HTMLImageElement | null, progress: number) {
  g.fillStyle = C.accent;
  g.fillRect(0, 0, W, H);
  const pad = 56;
  let y = 96;
  if (cover) {
    const size = W - pad * 2;
    g.save();
    g.beginPath();
    g.roundRect(pad, y, size, size * 0.72, 36);
    g.clip();
    const scale = Math.max(size / cover.width, (size * 0.72) / cover.height);
    g.drawImage(cover, pad + (size - cover.width * scale) / 2, y + (size * 0.72 - cover.height * scale) * 0.3, cover.width * scale, cover.height * scale);
    g.restore();
    y += size * 0.72 + 64;
  } else {
    y += 40;
  }
  g.fillStyle = C.bg;
  g.textBaseline = 'top';
  g.font = `96px ${F.display}, sans-serif`;
  for (const line of wrap(g, card.title, W - pad * 2, 2)) {
    g.fillText(line, pad, y);
    y += 100;
  }
  g.font = `32px ${F.semi}, sans-serif`;
  g.fillText(card.artist, pad, y + 8);

  // Waveform: bars already played are solid, the rest faded.
  const bars = card.peaks.length;
  const top = H - 520, height = 200;
  const step = (W - pad * 2) / bars;
  for (let i = 0; i < bars; i++) {
    const h = Math.max(8, Math.sqrt(card.peaks[i]) * height);
    g.globalAlpha = i / bars <= progress ? 1 : 0.35;
    g.beginPath();
    g.roundRect(pad + i * step, top + (height - h) / 2, Math.max(3, step * 0.6), h, 3);
    g.fill();
  }
  g.globalAlpha = 1;

  let bottom = H - 96;
  if (card.credit) {
    g.font = `26px ${F.semi}, sans-serif`;
    g.fillText(card.credit.toUpperCase(), pad, bottom - 26);
    bottom -= 60;
  }
  if (card.caption) {
    g.font = `44px ${F.display}, sans-serif`;
    const lines = wrap(g, card.caption, W - pad * 2, 3);
    bottom -= lines.length * 54;
    lines.forEach((line, i) => g.fillText(line, pad, bottom + i * 54));
  }
}

/** Records the card with its audio. `onProgress` is called with the seconds left. */
export async function makeSnippetVideo(audio: { channels: Float32Array[]; sampleRate: number }, card: SnippetCard, onProgress: (secondsLeft: number) => void): Promise<SnippetVideo> {
  const type = pickType();
  if (!type) throw new Error('This browser cannot record video. The audio can still be saved.');
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const cover = await loadImage(card.coverUrl);
  draw(g, card, cover, 0);

  const ctx = new AudioContext({ sampleRate: audio.sampleRate });
  const buffer = ctx.createBuffer(Math.min(2, audio.channels.length), audio.channels[0].length, audio.sampleRate);
  for (let i = 0; i < buffer.numberOfChannels; i++) buffer.copyToChannel(audio.channels[i] as Float32Array<ArrayBuffer>, i);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const dest = ctx.createMediaStreamDestination();
  src.connect(dest);

  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 256_000 });
  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('Recording the video failed.'));
  });

  const duration = buffer.duration;
  await ctx.resume();
  recorder.start(250);
  const began = ctx.currentTime + 0.05;
  src.start(began);
  // A timer rather than animation frames, so it keeps going if the tab is in the background.
  const timer = setInterval(() => {
    const t = Math.max(0, ctx.currentTime - began);
    draw(g, card, cover, Math.min(1, t / duration));
    onProgress(Math.max(0, Math.ceil(duration - t)));
  }, 33);
  await new Promise((r) => setTimeout(r, duration * 1000 + 250));
  clearInterval(timer);
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  void ctx.close();
  return { blob: new Blob(parts, { type: type.mime.split(';')[0] }), extension: type.extension };
}
