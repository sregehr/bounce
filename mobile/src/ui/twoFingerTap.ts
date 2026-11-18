// Telling a tap of two fingers from a scroll, a pinch or a rest of the hand. Kept apart from the hook that listens for it, so it can be tested without a screen.

/** What counts as a two-finger tap: both fingers down and up within this long, without sliding further than this. */
export const TWO_FINGER_TAP = { ms: 350, slop: 14 };

/**
 * Works out, from the touches of one gesture, whether it was a two-finger tap. Feed it each
 * touch event; it answers true on the one that completes a tap.
 */
export function twoFingerTap() {
  let began = 0;
  let most = 0;
  let moved = false;
  const starts = new Map<number, { x: number; y: number }>();
  return (type: 'start' | 'move' | 'end' | 'cancel', touches: { id: number; x: number; y: number }[], now: number) => {
    if (type === 'cancel') {
      most = 0;
      starts.clear();
      return false;
    }
    if (type === 'start') {
      if (starts.size === 0) {
        began = now;
        most = 0;
        moved = false;
      }
      for (const t of touches) if (!starts.has(t.id)) starts.set(t.id, { x: t.x, y: t.y });
      most = Math.max(most, touches.length);
      return false;
    }
    for (const t of touches) {
      const from = starts.get(t.id);
      if (from && Math.hypot(t.x - from.x, t.y - from.y) > TWO_FINGER_TAP.slop) moved = true;
    }
    if (type === 'move' || touches.length > 0) return false;
    // The last finger has lifted.
    const tapped = most === 2 && !moved && now - began <= TWO_FINGER_TAP.ms;
    starts.clear();
    most = 0;
    return tapped;
  };
}
