// Whether the screen in view is holding a recording that leaving would lose: a take or a capture
// that is running, being saved, or waiting to be saved. The record screens raise it (through
// `useRecordingGuard`); the navigation reads it, so the back swipe, a sheet's own ways of closing
// and the back control all stand down for as long as it is up.
import { useSyncExternalStore } from 'react';

const holders = new Set<string>();
const listeners = new Set<() => void>();

/** Raises or lowers the guard for one screen, named by `id`. */
export function setGuard(id: string, on: boolean) {
  if (on === holders.has(id)) return;
  if (on) holders.add(id);
  else holders.delete(id);
  listeners.forEach((fn) => fn());
}

export const isGuarded = () => holders.size > 0;

export function useGuarded() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    isGuarded,
    () => false,
  );
}

/**
 * Which navigation moves go ahead while the guard is up. Moving on by replacing the screen is the
 * record screen's own doing, once what it holds is saved or called off. Anything that goes back
 * (the system's back button, the browser's, a swipe) is someone leaving, and is held.
 */
export const leavesOnPurpose = (actionType: string) => actionType === 'REPLACE';
