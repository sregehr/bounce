import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { stopTransport, useEngine } from '@/engine/engine';

/** Playback state for one named thing; reads as stopped when something else is loaded. */
export function useTransport(id: string) {
  const t = useEngine((s) => s.transport);
  const mine = t.id === id;
  return { loaded: mine, playing: mine && t.playing, position: mine ? t.position : 0, duration: mine ? t.duration : 0, side: t.side };
}

/**
 * Stops playback when the screen stops being the one on show: on going back, and also when
 * another screen is pushed on top of it (the screen underneath stays alive in the stack).
 */
export function useStopOnLeave() {
  useFocusEffect(useCallback(() => () => stopTransport(), []));
}

/** Runs `enter` when the screen comes into view and whatever it returns when it leaves. */
export function useOnScreen(enter: () => void | (() => void)) {
  // The latest closure is used without re-running on every render.
  const ref = useRef(enter);
  ref.current = enter;
  useFocusEffect(useCallback(() => ref.current(), []));
}

/** A value that turns true for a moment after `fire` is called, for "tap again to confirm". */
export function useArmed(ms = 3000): [boolean, () => void, () => void] {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const arm = () => {
    setArmed(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), ms);
  };
  return [armed, arm, () => setArmed(false)];
}

/** Runs async work while tracking whether it is in progress and what went wrong. */
export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/**
 * While something is being recorded: keeps the screen from sleeping, and has the browser ask
 * before the tab is closed or reloaded, since either would lose what is in memory.
 */
export function useRecordingGuard(active: boolean) {
  useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof document === 'undefined') return;
    let lock: WakeLockSentinel | null = null;
    let over = false;
    const hold = () => {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(
        (l) => (over ? void l.release().catch(() => {}) : (lock = l)),
        () => {},
      );
    };
    // The browser drops the lock whenever the page is hidden, so it is taken again on return.
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    hold();
    document.addEventListener('visibilitychange', hold);
    window.addEventListener('beforeunload', warn);
    return () => {
      over = true;
      document.removeEventListener('visibilitychange', hold);
      window.removeEventListener('beforeunload', warn);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
