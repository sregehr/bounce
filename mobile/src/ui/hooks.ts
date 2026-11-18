import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect, useIsFocused, usePreventRemove } from 'expo-router';

import { stopTransport, useEngine } from '@/engine/engine';

import { leavesOnPurpose, setGuard } from './guard';
import { fail, tick, warn } from './haptics';
import { twoFingerTap } from './twoFingerTap';

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
    warn();
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
      fail();
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/**
 * While something is being recorded, saved, or held because it could not be saved: nothing that
 * leaves the screen by going back is let through (the swipe from the edge, the system's or the
 * browser's back button, closing a sheet), the screen is kept from sleeping, and the browser asks
 * before the tab is closed or reloaded. Any of those would lose what is in memory.
 */
export function useRecordingGuard(active: boolean) {
  // Only the screen in view holds the guard: one left open underneath a sheet is not being left.
  const id = useId();
  const focused = useIsFocused();
  const guarding = active && focused;
  useEffect(() => {
    setGuard(id, guarding);
    return () => setGuard(id, false);
  }, [id, guarding]);
  // The screen's own moves, once the recording is saved or called off, carry on.
  usePreventRemove(guarding, ({ data, repeat }) => {
    if (leavesOnPurpose(data.action.type)) repeat();
  });
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

/**
 * Undoes with a tap of two fingers anywhere on the screen, while it is the one on show. In a
 * browser only: the native app will use the system's own gestures. Text fields are left alone.
 */
export function useTwoFingerUndo(undo: () => unknown) {
  const latest = useRef(undo);
  latest.current = undo;
  const focused = useIsFocused();
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !focused) return;
    const feed = twoFingerTap();
    const on = (type: 'start' | 'move' | 'end' | 'cancel') => (e: TouchEvent) => {
      const typing = !!(e.target as HTMLElement | null)?.closest?.('input,textarea');
      const tapped = feed(type, [...e.touches].map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY })), e.timeStamp);
      if (tapped && !typing && latest.current()) tick();
    };
    const handlers = { touchstart: on('start'), touchmove: on('move'), touchend: on('end'), touchcancel: on('cancel') };
    for (const [name, fn] of Object.entries(handlers)) document.addEventListener(name, fn as EventListener, { passive: true });
    return () => {
      for (const [name, fn] of Object.entries(handlers)) document.removeEventListener(name, fn as EventListener);
    };
  }, [focused]);
}
