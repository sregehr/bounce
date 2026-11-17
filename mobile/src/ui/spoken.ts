// What adjustable controls say aloud, and how far one flick of VoiceOver moves them. Kept free of
// platform code so it can be tested. Values are spoken in the units on screen ("−3.5 dB",
// "0:42 of 3:10"), never as a bare number or a percentage of the track.
import { clock } from './theme';

/** A place in a track, as VoiceOver reads it: "0:42 of 3:10". */
export function positionText(seconds: number, total: number) {
  return total > 0 ? `${clock(Math.min(seconds, total))} of ${clock(total)}` : clock(seconds);
}

/** A stretch of a track: "0:30 to 0:50". */
export function stretchText(fromSec: number, lengthSec: number) {
  return `${clock(fromSec)} to ${clock(fromSec + lengthSec)}`;
}

/** How far through something, when there is no time to give: "42 percent". */
export function percentText(fraction: number) {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)} percent`;
}

/** One step up or down from a fraction, kept between 0 and 1. */
export function stepFraction(fraction: number, dir: 1 | -1, by = 0.05) {
  return Math.max(0, Math.min(1, Number((fraction + dir * by).toFixed(4))));
}

/** One step of a value on a grid, kept inside its range. */
export function stepValue(value: number, dir: 1 | -1, step: number, min: number, max: number) {
  const next = Math.round((value + dir * step - min) / step) * step + min;
  return Math.max(min, Math.min(max, Number(next.toFixed(6))));
}

/** Which way an accessibility action moves a control: the system's own increment and decrement. */
export const actionDir = (name: string): 1 | -1 | 0 => (name === 'increment' ? 1 : name === 'decrement' ? -1 : 0);

/** A frequency a third of an octave up or down, kept within what is heard (20 Hz to 20 kHz). */
export function stepFrequency(hz: number, dir: 1 | -1) {
  return Math.round(Math.max(20, Math.min(20000, hz * Math.pow(2, dir / 3))));
}
