// Text size. The system's larger text sizes are honoured up to 1.4 times: `Txt` and `Field` cap
// it there, and layouts ask here how big text is so rows can make room for it.
// On the phone the scale is the system's Dynamic Type setting. A browser has no such setting,
// so there it follows the browser's own default font size (16 px is 1), which is what its
// "font size" preference changes.
import { useSyncExternalStore } from 'react';
import { Dimensions, PixelRatio, Platform } from 'react-native';

/** The most the system's text size may enlarge text. Past it, fixed bars and rows stop fitting. */
export const MAX_TEXT_SCALE = 1.4;
/** From here up, rows that put a label and a value on one line stack them instead. */
const LARGE_FROM = 1.2;

const web = Platform.OS === 'web';

function read() {
  if (!web) return Math.min(MAX_TEXT_SCALE, PixelRatio.getFontScale());
  if (typeof document === 'undefined') return 1;
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  // A browser set to smaller text is left at the designed size; only larger is followed.
  return Number.isFinite(root) ? Math.max(1, Math.min(MAX_TEXT_SCALE, root / 16)) : 1;
}

let scale = read();
const listeners = new Set<() => void>();
const check = () => {
  const next = read();
  if (next === scale) return;
  scale = next;
  listeners.forEach((fn) => fn());
};
// The phone reports a new text size as a change of dimensions; a browser's is re-read when the window changes.
Dimensions.addEventListener('change', check);
if (web && typeof window !== 'undefined') window.addEventListener('resize', check);

/** How much larger than designed text is drawn: 1 normally, up to 1.4. */
export function useTextScale() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => scale,
    () => 1,
  );
}

/** Whether text is large enough that a label and its value no longer share a line comfortably. */
export const useLargeText = () => useTextScale() >= LARGE_FROM;

/**
 * What to multiply a font size by when drawing it. The phone enlarges text itself (up to the
 * cap on each `Text`), so this is 1 there; a browser does not, so the scale is applied by hand.
 */
export function useDrawScale() {
  const drawn = useTextScale();
  return web ? drawn : 1;
}

/** How many lines a list row's text may take: one normally, and room to wrap when text is large. */
export const useRowLines = (lines = 1) => (useLargeText() ? lines + 2 : lines);
