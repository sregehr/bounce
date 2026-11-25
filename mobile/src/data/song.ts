// Playing a project's song: keeps the mastered mix (and the untouched version for
// comparison) loaded in the engine, and swaps in a new render when settings change.
import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';

import type { Stereo } from '@/dsp/core';
import { engineState, pause, play, seek, setSide, toggle } from '@/engine/engine';
import type { RenderOutput } from '@/dsp/render';
import { carryOn, useTransport } from '@/ui/hooks';

import type { Project } from './model';
import { activeTake } from './store';
import { getRaw, mixSignature, useMix, type MixOptions } from './studio';

// The mix that was last put on the transport, and the settings it was made with.
let onAir: { id: string; signature: string; mix: RenderOutput } | null = null;

/**
 * `carry` is for screens that show the same song playing in two places, the Vault's panel and the full-screen
 * player: going from one to the other, the song carries on where it is and is not loaded or mastered again.
 */
export function useSong(project: Project | null, options: { autoplay?: boolean; compare?: boolean; repeat?: boolean; carry?: boolean; mix?: MixOptions } = {}) {
  const id = `song:${project?.id}`;
  const signature = project ? mixSignature(project, options.mix) : '';
  /** The mix already playing, when it is this song as it is set now. */
  const playing = () => (options.carry && onAir && onAir.id === id && onAir.signature === signature && engineState().transport.id === id ? onAir.mix : null);
  const [seed] = useState(playing);
  const state = useMix(project, options.mix, seed);
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
    // Already playing from the screen this one took over from: it carries on, untouched.
    if (playing() === mix) {
      carryOn(id);
      returning.current = false;
      wanted.current = false;
      first.current = false;
      return;
    }
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
    onAir = { id, signature, mix };
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

  return { ...state, error: state.error ?? error, t, took, id, toggle: () => (t.loaded ? toggle() : load(true)), playWhenReady: () => void (wanted.current = true), /** Stops, and forgets any request to play what is still being made: for when what is playing is being deleted. */ stop: () => ((wanted.current = false), pause()), pause, seek, setSide };
}
