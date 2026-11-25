import { blobs } from './db';
import type { Project } from './model';

/**
 * The song's cover as it leaves the app, behind a listening link or inside a file: scaled down in a browser so its longest side is `side`, and as it is elsewhere when it is small enough.
 * Null when there is no cover or it cannot be read; whatever wanted it goes without.
 */
export async function coverFor(project: Pick<Project, 'cover'>, side: number): Promise<Blob | null> {
  try {
    const key = project.cover.imageKey ?? project.cover.photoKey;
    const stored = key ? await blobs.get(key) : null;
    if (!stored) return null;
    if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return /^image\/(jpeg|png|webp)$/.test(stored.type) && stored.size <= 6 * 1024 * 1024 ? stored : null;
    const bitmap = await createImageBitmap(stored, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(stored));
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } catch {
    return null;
  }
}
