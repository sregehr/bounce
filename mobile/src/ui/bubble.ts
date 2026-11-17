// Where a slider's value bubble sits. Kept apart from the slider so the sums can be tested by themselves.

export const BUBBLE_HEIGHT = 30;
/** How far the bubble stays from the edge of the screen. */
export const BUBBLE_MARGIN = 8;
/** The gap between the thumb, which is 18 points across, and the bubble. */
const GAP = 8;

/**
 * Centred over the thumb, moved sideways as far as it takes to stay on the screen, and under
 * the thumb only when there is no room above it. `at` is the thumb's centre from the slider's
 * left edge, `held` is where the slider is in the window, and the answer is measured from the
 * slider's own top left corner.
 */
export function bubblePlace(at: number, width: number, held: { left: number; top: number }, height: number, windowWidth: number) {
  const least = BUBBLE_MARGIN - held.left;
  const most = windowWidth - BUBBLE_MARGIN - width - held.left;
  const left = Math.max(least, Math.min(most, at - width / 2));
  const above = height / 2 - 9 - GAP - BUBBLE_HEIGHT;
  const below = held.top + above < BUBBLE_MARGIN;
  return { left, top: below ? height / 2 + 9 + GAP : above, below };
}
