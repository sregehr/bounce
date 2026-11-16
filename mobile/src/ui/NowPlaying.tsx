// What the full-screen player and the Vault's docked panel share: the song on the transport,
// skipping through the Vault, and the controls that move through a song.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import type { Project } from '@/data/model';
import { artistOf, songsIn } from '@/data/songs';
import { activeTake, openSong, setCurrent, useLibrary } from '@/data/store';
import { useSong } from '@/data/song';

import { PauseIcon, PlayIcon, SkipIcon, Slider, Txt, s } from './kit';
import { C, clock, lufs } from './theme';

/**
 * A finished song, playing. Only the screen in view drives the audio (see `useSong`), so the
 * player and the Vault's panel can both use this without playing over each other.
 * `open` is how skipping shows the next song; it defaults to opening it in the library.
 */
export function useNowPlaying(project: Project | null, { autoplay, open = openSong }: { autoplay?: boolean; open?: (id: string) => void } = {}) {
  const projects = useLibrary((l) => l.projects);
  const profile = useLibrary((l) => l.profile);
  const song = useSong(project, { autoplay });
  const take = activeTake(project);

  // Skipping moves through the finished songs in the Vault.
  const songs = songsIn(projects);
  const at = songs.findIndex((p) => p.id === project?.id);
  const jump = (step: number) => {
    const next = songs[(at + step + songs.length) % songs.length];
    if (next && next.id !== project?.id) open(next.id);
    else song.seek(0);
  };
  /** Back goes to the top of the song first, and to the song before it from there. */
  const previous = () => (song.t.position > 3 ? song.seek(0) : jump(-1));

  // The beat this song was made from, if it is still in the library: recording over it again starts another version.
  const beat = project ? projects.find((p) => !p.saved && p.id === project.saved?.from) : undefined;
  const again = () => {
    if (!beat) return;
    setCurrent(beat.id);
    if (router.canDismiss()) router.dismissAll();
    router.push('/vocals');
  };

  const artist = project ? artistOf(project, profile) : '';
  const credit = [artist, profile.producer ? `Prod. ${profile.producer}` : null].filter(Boolean).join(' · ');
  const mastering = !project ? '' : song.error ? 'Could not render' : !song.mix ? song.stage || 'Mastering' : [take ? 'Mastered' : 'Beat', project.overrides.master ? 'by hand' : project.master.style, lufs(song.mix.lufs, 0)].join(' · ');

  return { project, song, take, jump, previous, beat, again, againLabel: project?.takes.length ? 'Record another version' : 'Record a vocal over this beat', credit, mastering, hasLyrics: !!project?.lyrics.trim() };
}

export type NowPlaying = ReturnType<typeof useNowPlaying>;

/** Where the song is, with a slider to move through it. */
export function Scrubber({ now, height = 28 }: { now: NowPlaying; height?: number }) {
  const [drag, setDrag] = useState<number | null>(null);
  const { song, project } = now;
  const t = song.t;
  return (
    <View style={{ gap: 2 }}>
      <Slider
        label="Position in track"
        value={Math.min(drag ?? t.position, t.duration)}
        min={0}
        max={Math.max(1, t.duration)}
        step={0.1}
        height={height}
        disabled={!t.loaded}
        onChange={setDrag}
        onCommit={(v) => {
          setDrag(null);
          song.seek(v);
        }}
      />
      <View style={[s.row, s.between]}>
        <Txt size={13} color={C.muted} style={{ fontVariant: ['tabular-nums'] }}>
          {clock(drag ?? t.position)}
        </Txt>
        <Txt size={13} color={C.muted} style={{ fontVariant: ['tabular-nums'] }}>
          {clock(t.duration || project?.stats?.durationSec || 0)}
        </Txt>
      </View>
    </View>
  );
}

/** Previous, play or pause, next. */
export function SkipPlay({ now, size = 72, skip = 52, gap = 28 }: { now: NowPlaying; size?: number; skip?: number; gap?: number }) {
  const { song } = now;
  const t = song.t;
  return (
    <View style={[s.row, { justifyContent: 'center', gap }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous track" onPress={now.previous} style={{ width: skip, height: skip, alignItems: 'center', justifyContent: 'center' }}>
        <SkipIcon back />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.playing ? 'Pause' : 'Play'}
        disabled={!t.loaded}
        onPress={song.toggle}
        style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', opacity: !t.loaded ? 0.4 : pressed ? 0.85 : 1 })}
      >
        {t.playing ? <PauseIcon color={C.bg} /> : <PlayIcon size={26} color={C.bg} />}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Next track" onPress={() => now.jump(1)} style={{ width: skip, height: skip, alignItems: 'center', justifyContent: 'center' }}>
        <SkipIcon />
      </Pressable>
    </View>
  );
}
