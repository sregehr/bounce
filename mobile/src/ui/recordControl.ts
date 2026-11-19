// The mic screen owns recording: its own button starts and stops a take. It tells the navigation
// here what state it is in, so the bar can step aside while a take runs or waits to be saved.
import { useSyncExternalStore } from 'react';

export type RecordControl = {
  /** `off`: no microphone yet. `ready`: the record button records. `recording`: it stops the take. */
  state: 'off' | 'ready' | 'recording';
  busy: boolean;
  /** A take is waiting to be saved: the tabs stay away until it is saved, exported or dropped. */
  holding?: boolean;
};

/**
 * What the record button should be. A take in progress comes before everything else: the button must
 * always stop it, even when the microphone has dropped out from under it.
 */
export const recordState = (live: boolean, mode: 'idle' | 'listening' | 'recording'): RecordControl['state'] => (mode === 'recording' ? 'recording' : live ? 'ready' : 'off');

let current: RecordControl | null = null;
const listeners = new Set<() => void>();

export function setRecordControl(next: RecordControl | null) {
  current = next;
  listeners.forEach((fn) => fn());
}

/** What the mic screen wants the bar's mic to be, or null when that screen is not open. */
export function useRecordControl(): RecordControl | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => current,
  );
}
