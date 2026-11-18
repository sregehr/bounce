// How long a file may be to come in as a beat, decided from what its header says, before the
// file is read or decoded: decoding an hour of audio can use up the tab's memory first.
import type { Sniffed } from '@/dsp/sniff';

export const MAX_IMPORT_SECONDS = 12 * 60;
/**
 * A file that does not say how long it is can only be judged by its size. Twelve minutes of
 * the heaviest thing a beat arrives as (lossless, 24-bit, 96 kHz) is under this.
 */
export const MAX_UNMEASURED_BYTES = 300 * 1024 * 1024;

export const TOO_LONG = 'That file is over 12 minutes long. Bounce is built for beats; trim it first.';
export const TOO_BIG = 'That file is too big to open here. Bounce is built for beats; trim it first.';

/** Why a file should be turned away unread, or null when it may be opened. */
export function importRefusal(said: Sniffed, size: number): string | null {
  if (said.seconds !== null) return said.seconds > MAX_IMPORT_SECONDS ? TOO_LONG : null;
  if (said.atLeastSeconds !== null && said.atLeastSeconds > MAX_IMPORT_SECONDS) return TOO_LONG;
  return size > MAX_UNMEASURED_BYTES ? TOO_BIG : null;
}
