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

export function useSong(project: Project | null, options: { autoplay?: boolean; compare?: boolean; mix?: MixOptions } = {}) {
  const id = `song:${project?.id}`;
  const state = useMix(project, options.mix);
  const t = useTransport(id);
  const [raw, setRaw] = useState<Stereo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const started = useRef(0);
  const first = useRef(true);
  const take = activeTake(project);
  const rawKey = project && options.compare ? `${project.id}:${project.beat.key}:${take?.id}:${JSON.stringify(take?.loop)}:${project.beat.bpm}` : '';

  useEffect(() => {
    if (state.busy) started.current = Date.now();
    else if (started.current) setTook((Date.now() - started.current) / 1000);
  }, [state.busy]);

  useEffect(() => {
    setRaw(null);
    if (!project || !rawKey) return;
    let live = true;
    getRaw(project).then((r) => live && setRaw(r), () => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawKey]);

  // Screens stay alive underneath the one on show; only the one in view drives the audio.
  const focused = useIsFocused();
  const wasFocused = useRef(false);
  useEffect(() => {
    const mix = state.mix;
    const returning = focused && !wasFocused.current && !first.current;
    wasFocused.current = focused;
    if (!focused || !mix || (options.compare && !raw)) return;
    // Plays by itself the first time; coming back to the screen loads it paused.
    const autoplay = first.current ? options.autoplay !== false : returning ? false : undefined;
    first.current = false;
    load(autoplay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mix, raw, id, focused]);

  /** Puts the mix on the transport. Something else may have taken it over since, such as a take being previewed. */
  function load(autoplay?: boolean) {
    const mix = state.mix;
    if (!mix) return;
    play(id, {
      a: { channels: mix.channels, sampleRate: mix.sampleRate },
      b: options.compare && raw ? { channels: raw, sampleRate: mix.sampleRate } : undefined,
      keepPosition: true,
      autoplay,
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not play.'));
  }

  return { ...state, error: state.error ?? error, t, took, id, toggle: () => (t.loaded ? toggle() : load(true)), pause, seek, setSide };
}
