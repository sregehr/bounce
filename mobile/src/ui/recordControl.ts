// The mic in the bottom bar doubles as the record button while the mic screen is open. That
// screen owns recording, so it hands the bar what to show and what a press does through here.
import { useSyncExternalStore } from 'react';

export type RecordControl = {
  /** `off`: no microphone yet, a press connects one. `ready`: a press records. `recording`: a press stops. */
  state: 'off' | 'ready' | 'recording';
  busy: boolean;
  press: () => void;
};

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

// Pressing record with no microphone connected opens a small sheet above the button to connect one.
let asking = false;
const askListeners = new Set<() => void>();

export function askForMic(open: boolean) {
  if (asking === open) return;
  asking = open;
  askListeners.forEach((fn) => fn());
}

export function useAskingForMic(): boolean {
  return useSyncExternalStore(
    (fn) => {
      askListeners.add(fn);
      return () => askListeners.delete(fn);
    },
    () => asking,
    () => asking,
  );
}
