// The artist view takes over the whole mic screen, so the navigation around it steps aside.
// The mic screen says when it is up through here.
import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

export function setArtistViewOpen(next: boolean) {
  if (open === next) return;
  open = next;
  listeners.forEach((fn) => fn());
}

/** Whether the artist view is covering the mic screen. */
export function useArtistViewOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
    () => open,
  );
}
