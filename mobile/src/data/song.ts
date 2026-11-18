// Playing a project's song: keeps the mastered mix (and the untouched version for
// comparison) loaded in the engine, and swaps in a new render when settings change.
import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';

import type { Stereo } from '@/dsp/core';
import { pause, play, seek, setSide, toggle } from '@/engine/engine';
import { useTransport } from '@/ui/hooks';

import type { Project } from './model';
import { activeTake } from './store';
import { getRaw, useMix, type MixOptions } from './studio';

export function useSong(project: Project | null, options: { autoplay?: boolean; compare?: boolean; repeat?: boolean; mix?: MixOptions } = {}) {
  const id = `song:${project?.id}`;
  const state = useMix(project, options.mix);
  const t = useTransport(id);
  const [raw, setRaw] = useState<Stereo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const started = useRef(0);
  const first = useRef(true);
  // Set when the user asked to hear something that still has to be rendered.
  const wanted = useRef(false);
  const take = activeTake(project);
  const rawKey = project && options.compare ? `${project.id}:${project.beat.key}:${take?.id}:${JSON.stringify(take?.loop)}:${project.beat.bpm}` : '';

  useEffect(() => {
    if (state.busy) started.current = Date.now();
    else if (started.current) setTook((Date.now() - started.current) / 1000);
  }, [state.busy]);

  // Screens stay alive underneath the one on show; only the one in view drives the audio.
  const focused = useIsFocused();

  useEffect(() => {
    setRaw(null);
    // A screen underneath lets go of its untouched version, which is as big as the song and quick to make again.
    if (!project || !rawKey || !focused) return;
    let live = true;
    getRaw(project).then((r) => live && setRaw(r), () => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawKey, focused]);

  const wasFocused = useRef(false);
  // Coming back to the screen is remembered until the song is loaded, which may wait on the untouched version.
  const returning = useRef(false);
  useEffect(() => {
    const mix = state.mix;
    if (focused && !wasFocused.current && !first.current) returning.current = true;
    wasFocused.current = focused;
    if (!focused || !mix || (options.compare && !raw)) return;
    // Plays by itself the first time; coming back to the screen loads it paused.
    const autoplay = wanted.current ? true : first.current ? options.autoplay !== false : returning.current ? false : undefined;
    returning.current = false;
    wanted.current = false;
    first.current = false;
    load(autoplay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mix, raw, id, focused, options.repeat]);

  /** Puts the mix on the transport. Something else may have taken it over since, such as a take being previewed. */
  function load(autoplay?: boolean) {
    const mix = state.mix;
    if (!mix) return;
    play(id, {
      a: { channels: mix.channels, sampleRate: mix.sampleRate },
      b: options.compare && raw ? { channels: raw, sampleRate: mix.sampleRate } : undefined,
      // Asked to play, it starts from the top; otherwise a re-render carries on from where it was.
      keepPosition: autoplay !== true,
      autoplay,
      // The song runs to the end of a bar, so it repeats in time.
      loop: options.repeat,
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not play.'));
  }

  return { ...state, error: state.error ?? error, t, took, id, toggle: () => (t.loaded ? toggle() : load(true)), playWhenReady: () => void (wanted.current = true), pause, seek, setSide };
}
