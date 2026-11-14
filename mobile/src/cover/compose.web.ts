// Cover art, made in the browser: cut the person out of a photo and place them in a drawn scene.
// Nothing is uploaded. The cut-out uses a small model that the browser downloads once.
import type { SceneId } from '@/data/model';

export const COVER_W = 864;
export const COVER_H = 1080;

// The segmentation library is loaded from a pinned CDN release at the moment it is first
// needed. (It cannot go through the app's bundler, and it is only used on this one screen.)
const LIBRARY = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the image.'))), type, quality));

/** Crops a photo to the cover's shape and size, turned the right way up. */
export async function normalisePhoto(photo: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('That file could not be read as a photo. Try a JPEG or PNG.');
  }
  const [c, g] = canvas(COVER_W, COVER_H);
  const scale = Math.max(COVER_W / bitmap.width, COVER_H / bitmap.height);
  const w = bitmap.width * scale, h = bitmap.height * scale;
  // Keep a little more of the top than the bottom: faces sit high in a portrait.
  g.drawImage(bitmap, (COVER_W - w) / 2, (COVER_H - h) * 0.35, w, h);
  bitmap.close();
  return toBlob(c, 'image/jpeg', 0.92);
}

type Segmenter = { segment: (image: HTMLCanvasElement) => { confidenceMasks?: { getAsFloat32Array: () => Float32Array; width: number; height: number; close: () => void }[] } };
type Vision = {
  FilesetResolver: { forVisionTasks: (path: string) => Promise<unknown> };
  ImageSegmenter: { createFromOptions: (files: unknown, options: object) => Promise<unknown> };
};
let segmenter: Promise<Segmenter> | null = null;

function loadSegmenter(): Promise<Segmenter> {
  if (!segmenter) {
    segmenter = (async () => {
      // Written this way so the bundler leaves the import for the browser to do.
      const load = new Function('url', 'return import(url)') as (url: string) => Promise<Vision>;
      const vision = await load(LIBRARY);
      const files = await vision.FilesetResolver.forVisionTasks(WASM);
      return (await vision.ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      })) as unknown as Segmenter;
    })();
    segmenter.catch(() => (segmenter = null));
  }
  return segmenter;
}

/**
 * The person from a normalised photo, on a transparent background.
 * Resolves to null when no clear subject is found or the model cannot be loaded.
 */
export async function cutOut(photo: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(photo);
    const [src, sg] = canvas(bitmap.width, bitmap.height);
    sg.drawImage(bitmap, 0, 0);
    bitmap.close();
    const seg = await loadSegmenter();
    const masks = seg.segment(src).confidenceMasks;
    if (!masks?.length) return null;
    const mask = masks[masks.length - 1];
    const values = mask.getAsFloat32Array();
    const mw = mask.width, mh = mask.height;

    // Work out whether the mask marks the person or the background: a person is in the
    // middle of a portrait, not in the top corners.
    const mean = (x0: number, y0: number, x1: number, y1: number) => {
      let sum = 0, n = 0;
      for (let y = Math.floor(y0 * mh); y < y1 * mh; y += 3) for (let x = Math.floor(x0 * mw); x < x1 * mw; x += 3) {
        sum += values[y * mw + x];
        n++;
      }
      return n ? sum / n : 0;
    };
    const centre = mean(0.35, 0.3, 0.65, 0.8);
    const corners = (mean(0, 0, 0.15, 0.15) + mean(0.85, 0, 1, 0.15)) / 2;
    const inverted = corners > centre;
    let covered = 0;
    const [m, mg] = canvas(mw, mh);
    const data = mg.createImageData(mw, mh);
    for (let i = 0; i < values.length; i++) {
      let v = inverted ? 1 - values[i] : values[i];
      // Sharpen the soft edge without making it jagged.
      v = v <= 0.3 ? 0 : v >= 0.7 ? 1 : (v - 0.3) / 0.4;
      if (v > 0.5) covered++;
      data.data[i * 4 + 3] = Math.round(v * 255);
    }
    masks.forEach((k) => k.close());
    const share = covered / values.length;
    // Nobody in the picture, or the "subject" is nearly everything: not worth cutting out.
    if (share < 0.04 || share > 0.92) return null;
    mg.putImageData(data, 0, 0);

    const [out, og] = canvas(src.width, src.height);
    og.filter = 'blur(1.5px)';
    og.drawImage(m, 0, 0, src.width, src.height);
    og.filter = 'none';
    og.globalCompositeOperation = 'source-in';
    og.drawImage(src, 0, 0);
    return await toBlob(out, 'image/png');
  } catch {
    return null;
  }
}

// ---------- Scenes ----------

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function studio(g: CanvasRenderingContext2D, W: number, H: number) {
  const wall = g.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#221a14');
  wall.addColorStop(0.7, '#15100d');
  wall.addColorStop(1, '#0b0908');
  g.fillStyle = wall;
  g.fillRect(0, 0, W, H);
  // Acoustic foam: a grid of tiles, each lit from the top left.
  const tile = W / 6;
  const r = rng(11);
  for (let y = 0; y < H * 0.72; y += tile) for (let x = 0; x < W; x += tile) {
    const shade = 18 + Math.floor(r() * 10);
    g.fillStyle = `rgb(${shade + 10}, ${shade + 4}, ${shade})`;
    g.fillRect(x + 3, y + 3, tile - 6, tile - 6);
    const ridge = g.createLinearGradient(x, y, x + tile, y + tile);
    ridge.addColorStop(0, 'rgba(255, 190, 120, 0.10)');
    ridge.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
    ridge.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    g.fillStyle = ridge;
    g.fillRect(x + 3, y + 3, tile - 6, tile - 6);
  }
  // A warm lamp off to one side, and a strip light along the desk.
  const lamp = g.createRadialGradient(W * 0.16, H * 0.2, 0, W * 0.16, H * 0.2, W * 0.75);
  lamp.addColorStop(0, 'rgba(255, 176, 32, 0.55)');
  lamp.addColorStop(0.4, 'rgba(255, 140, 40, 0.16)');
  lamp.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#080706';
  g.fillRect(0, H * 0.82, W, H * 0.18);
  g.shadowColor = '#ffb020';
  g.shadowBlur = 40;
  g.fillStyle = '#ffb020';
  g.fillRect(0, H * 0.82 - 3, W, 5);
  g.shadowBlur = 0;
}

function stage(g: CanvasRenderingContext2D, W: number, H: number) {
  g.fillStyle = '#07060b';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  const beams: [number, number, string][] = [
    [0.12, 0.42, '255, 60, 150'],
    [0.38, 0.5, '90, 120, 255'],
    [0.66, 0.46, '255, 176, 32'],
    [0.9, 0.58, '120, 90, 255'],
  ];
  for (const [from, to, colour] of beams) {
    const beam = g.createLinearGradient(W * from, 0, W * to, H * 0.9);
    beam.addColorStop(0, `rgba(${colour}, 0.6)`);
    beam.addColorStop(1, `rgba(${colour}, 0)`);
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(W * from - 8, 0);
    g.lineTo(W * from + 8, 0);
    g.lineTo(W * to + W * 0.2, H * 0.92);
    g.lineTo(W * to - W * 0.2, H * 0.92);
    g.closePath();
    g.fill();
    const lamp = g.createRadialGradient(W * from, 0, 0, W * from, 0, W * 0.12);
    lamp.addColorStop(0, `rgba(${colour}, 0.95)`);
    lamp.addColorStop(1, `rgba(${colour}, 0)`);
    g.fillStyle = lamp;
    g.fillRect(0, 0, W, H * 0.2);
  }
  // Haze near the floor catches the light.
  const haze = g.createLinearGradient(0, H * 0.55, 0, H);
  haze.addColorStop(0, 'rgba(120, 100, 200, 0)');
  haze.addColorStop(1, 'rgba(150, 110, 220, 0.28)');
  g.fillStyle = haze;
  g.fillRect(0, H * 0.55, W, H * 0.45);
  g.globalCompositeOperation = 'source-over';
}

function rooftop(g: CanvasRenderingContext2D, W: number, H: number) {
  const sky = g.createLinearGradient(0, 0, 0, H * 0.8);
  sky.addColorStop(0, '#1a1a3e');
  sky.addColorStop(0.4, '#5a2f6e');
  sky.addColorStop(0.72, '#ff5e62');
  sky.addColorStop(1, '#ffb347');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const sun = g.createRadialGradient(W * 0.68, H * 0.66, 0, W * 0.68, H * 0.66, W * 0.55);
  sun.addColorStop(0, 'rgba(255, 244, 200, 1)');
  sun.addColorStop(0.08, 'rgba(255, 210, 120, 0.9)');
  sun.addColorStop(0.5, 'rgba(255, 130, 80, 0.18)');
  sun.addColorStop(1, 'rgba(255, 130, 80, 0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H);
  // Two rows of buildings, the nearer one darker, with a few lit windows.
  const r = rng(29);
  for (const [base, colour, minH, maxH] of [[0.8, '#2a1c3a', 0.1, 0.3], [0.86, '#120d1c', 0.06, 0.2]] as const) {
    for (let x = -10; x < W; ) {
      const w = W * (0.06 + r() * 0.1);
      const h = H * (minH + r() * (maxH - minH));
      g.fillStyle = colour;
      g.fillRect(x, H * base - h, w, h + H * 0.2);
      g.fillStyle = 'rgba(255, 200, 120, 0.7)';
      for (let wy = H * base - h + 10; wy < H * base - 8; wy += 16) for (let wx = x + 6; wx < x + w - 8; wx += 12) if (r() > 0.78) g.fillRect(wx, wy, 5, 8);
      x += w + 2;
    }
  }
  // The roof itself and its ledge.
  g.fillStyle = '#0c0912';
  g.fillRect(0, H * 0.88, W, H * 0.12);
  g.fillStyle = '#1c1626';
  g.fillRect(0, H * 0.875, W, 10);
}

const LOOK: Record<Exclude<SceneId, 'photo'>, { draw: typeof studio; tint: string; rim: string; grade: string }> = {
  studio: { draw: studio, tint: 'rgba(255, 150, 60, 0.16)', rim: 'rgba(255, 176, 32, 0.55)', grade: 'rgba(40, 20, 0, 0.25)' },
  stage: { draw: stage, tint: 'rgba(130, 90, 255, 0.18)', rim: 'rgba(255, 70, 160, 0.6)', grade: 'rgba(10, 0, 40, 0.3)' },
  rooftop: { draw: rooftop, tint: 'rgba(255, 110, 70, 0.2)', rim: 'rgba(255, 190, 110, 0.65)', grade: 'rgba(50, 10, 30, 0.2)' },
};

function finish(g: CanvasRenderingContext2D, W: number, H: number) {
  const vignette = g.createRadialGradient(W / 2, H * 0.45, W * 0.35, W / 2, H * 0.5, W * 0.95);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  g.fillStyle = vignette;
  g.fillRect(0, 0, W, H);
  // Film grain ties the drawn scene and the photographed person together.
  const r = rng(5);
  g.globalAlpha = 0.07;
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() > 0.5 ? '#fff' : '#000';
    g.fillRect(r() * W, r() * H, 1.6, 1.6);
  }
  g.globalAlpha = 1;
}

/** Builds the cover for one scene. With no cut-out, the scene's colours are laid over the whole photo instead. */
export async function composeScene(scene: SceneId, photo: Blob, cutout: Blob | null): Promise<Blob> {
  if (scene === 'photo') return photo;
  const W = COVER_W, H = COVER_H;
  const look = LOOK[scene];
  const [c, g] = canvas(W, H);
  if (!cutout) {
    const bitmap = await createImageBitmap(photo);
    g.filter = 'saturate(0.7) contrast(1.1)';
    g.drawImage(bitmap, 0, 0, W, H);
    g.filter = 'none';
    bitmap.close();
    const [s, sg] = canvas(W, H);
    look.draw(sg, W, H);
    g.globalAlpha = 0.5;
    g.globalCompositeOperation = 'soft-light';
    g.drawImage(s, 0, 0);
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.35;
    g.drawImage(s, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    finish(g, W, H);
    return toBlob(c, 'image/jpeg', 0.9);
  }
  look.draw(g, W, H);
  const person = await createImageBitmap(cutout);
  // Tint the person towards the scene's light, on a copy so the scene is untouched.
  const [p, pg] = canvas(W, H);
  pg.drawImage(person, 0, 0, W, H);
  pg.globalCompositeOperation = 'source-atop';
  pg.fillStyle = look.tint;
  pg.fillRect(0, 0, W, H);
  const shade = pg.createLinearGradient(0, H * 0.4, 0, H);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  shade.addColorStop(1, look.grade);
  pg.fillStyle = shade;
  pg.fillRect(0, 0, W, H);
  person.close();
  // A glow behind them, as if the scene's light were wrapping round, then the person on top.
  g.save();
  g.filter = 'blur(22px)';
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.55;
  const [halo, hg] = canvas(W, H);
  hg.drawImage(p, 0, 0);
  hg.globalCompositeOperation = 'source-in';
  hg.fillStyle = look.rim;
  hg.fillRect(0, 0, W, H);
  g.drawImage(halo, 0, 0);
  g.restore();
  g.drawImage(p, 0, 0);
  finish(g, W, H);
  return toBlob(c, 'image/jpeg', 0.9);
}

export const coverSupported = true;
