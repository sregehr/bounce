// The phone build makes covers with the system's own subject-lifting; that arrives with the phone app.
import type { SceneId } from '@/data/model';

export const COVER_W = 864;
export const COVER_H = 1080;
export const coverSupported = false;
export async function normalisePhoto(photo: Blob): Promise<Blob> {
  return photo;
}
export async function cutOut(_photo: Blob): Promise<Blob | null> {
  return null;
}
export async function composeScene(_scene: SceneId, photo: Blob, _cutout: Blob | null): Promise<Blob> {
  return photo;
}
export async function composeBackdrop(backdrop: Blob, _cutout: Blob | null): Promise<Blob> {
  return backdrop;
}
export async function toDataUrl(_photo: Blob): Promise<string> {
  return '';
}
