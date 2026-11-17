// Motion that respects the system's Reduce Motion setting. Everything that moves in the app
// asks here first, so one switch in Settings (or in the browser) stills all of it.
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

let reduced = false;
let started = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === reduced) return;
  reduced = next;
  listeners.forEach((fn) => fn());
}

/** Starts listening to the system setting the first time anything asks. */
function start() {
  if (started) return;
  started = true;
  void AccessibilityInfo.isReduceMotionEnabled().then(set, () => {});
  AccessibilityInfo.addEventListener('reduceMotionChanged', set);
}

/** Whether the person has asked for less motion. For code outside a component; it is right once the app has drawn once. */
export function reduceMotion() {
  start();
  return reduced;
}

/** Whether the person has asked for less motion. Re-renders when they change it. */
export function useReduceMotion() {
  start();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => reduced,
    () => false,
  );
}

/** Transforms and opacity run off the JavaScript thread on the phone; the browser has no such driver. */
export const NATIVE = Platform.OS !== 'web';
