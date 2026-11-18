// When a control should be felt. Kept free of platform code so the rules can be tested:
// a haptic fires once for each event here, and never on every move of a drag.

/**
 * True when a slider moving from `prev` to `next` arrives at, or passes through, one of its
 * resting points (the centre of a ±dB control, the value a double tap puts it back to).
 * Sitting on a resting point, or moving off it, is not an arrival.
 */
export function reachedDetent(prev: number, next: number, detents: readonly number[]) {
  if (prev === next) return false;
  return detents.some((d) => prev !== d && (next === d || (prev < d && next > d) || (prev > d && next < d)));
}

/**
 * Whether a row being swiped is past the point where letting go shows its Delete button.
 * `x` is how far it has been pulled (negative is to the left) and `at` is that point. Once past,
 * it has to come back by `slack` before it counts as not past, so a finger resting on the line
 * does not flip it back and forth.
 */
export function pastThreshold(was: boolean, x: number, at: number, slack = 10) {
  return was ? x < at + slack : x < at;
}
