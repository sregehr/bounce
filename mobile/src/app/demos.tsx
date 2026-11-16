import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { addDemoBeat, addDemoSong } from '@/data/beats';
import { DEMO_GROUPS, DEMO_SONGS } from '@/data/demoSongs';
import type { Project } from '@/data/model';
import { DEMO, makeDemoBeat } from '@/dsp/demoBeat';
import { decode, play, stopTransport, toggle } from '@/engine/engine';
import { Eyebrow, Muted, NavLink, RoundPlay, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useStopOnLeave, useTask, useTransport } from '@/ui/hooks';
import { C, clock } from '@/ui/theme';

/** One demo: a button to hear it first, and the rest of the row adds it. */
function Row({ id, title, detail, busy, disabled, divided, onPress, load }: { id: string; title: string; detail: string; busy: boolean; disabled: boolean; divided: boolean; onPress: () => void; load: () => Promise<Pcm> }) {
  const tid = `demo:${id}`;
  const t = useTransport(tid);
  const preview = useTask();
  const onPreview = () => {
    if (t.loaded) return toggle();
    void preview.run(async () => play(tid, { a: await load() }));
  };
  return (
    <View style={[s.row, { minHeight: 60, gap: 12 }, divided && s.divided]}>
      <RoundPlay size={36} icon={13} playing={t.playing} onPress={onPreview} disabled={preview.busy || disabled} label={t.playing ? `Pause ${title}` : `Preview ${title}`} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${title}`}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [s.row, s.between, { flex: 1, minHeight: 60, gap: 12, opacity: disabled && !busy ? 0.4 : pressed ? 0.7 : 1 }]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Txt size={16} w="semi" numberOfLines={1}>
            {title}
          </Txt>
          <Txt size={13} color={preview.error ? C.recText : C.muted} numberOfLines={1}>
            {preview.error ?? (preview.busy ? 'Loading the preview…' : detail)}
          </Txt>
        </View>
        <Txt size={13} w="semi" color={busy ? C.muted : C.accent}>
          {busy ? 'Loading…' : 'Add'}
        </Txt>
      </Pressable>
    </View>
  );
}

type Pcm = { channels: Float32Array[]; sampleRate: number };
// A preview that has been fetched once plays at once the next time.
const previews = new Map<string, Promise<Pcm>>();
const once = (id: string, make: () => Promise<Pcm>) => {
  let made = previews.get(id);
  if (!made) {
    made = make().catch((e) => {
      previews.delete(id);
      throw e;
    });
    previews.set(id, made);
  }
  return made;
};
const demoAudio = (id: string, title: string) =>
  once(id, async () => {
    try {
      const response = await fetch(`/demo/${id}.m4a`);
      if (!response.ok) throw new Error(String(response.status));
      return await decode(await response.arrayBuffer());
    } catch {
      throw new Error(`"${title}" could not be loaded.`);
    }
  });
const builtIn = () =>
  once('built-in', async () => {
    const [left, right] = makeDemoBeat();
    return { channels: [left, right], sampleRate: DEMO.sampleRate };
  });

export default function Demos() {
  const task = useTask();
  const [picked, setPicked] = useState<string | null>(null);
  useStopOnLeave();

  const add = (id: string, work: () => Promise<Project | null>) => {
    if (task.busy) return;
    setPicked(id);
    stopTransport();
    void task.run(async () => void ((await work()) && router.replace('/song')));
  };

  return (
    <Screen gap={22} padBottom={40}>
      <TopBar left="Demo songs" right={<NavLink to="/" back>Close</NavLink>} />
      <Muted>Ready-made beats to freestyle over. Play one to hear it first; tap its name to add it to your library.</Muted>
      {task.error && (
        <Txt size={13} color={C.recText}>
          {task.error}
        </Txt>
      )}

      {DEMO_GROUPS.map((group) => {
        const songs = DEMO_SONGS.filter((song) => song.group === group);
        return (
          <View key={group}>
            <Eyebrow>{group}</Eyebrow>
            {songs.map((song, i) => (
              <Row
                key={song.id}
                id={song.id}
                load={() => demoAudio(song.id, song.title)}
                title={song.title}
                detail={`${song.style} · ${Math.round(song.bpm)} BPM · ${clock(song.seconds)}`}
                busy={task.busy && picked === song.id}
                disabled={task.busy}
                divided={i < songs.length - 1}
                onPress={() => add(song.id, () => addDemoSong(song))}
              />
            ))}
          </View>
        );
      })}

      <View>
        <Eyebrow>Built in</Eyebrow>
        <Row
          id="built-in"
          load={builtIn}
          title={DEMO.name}
          detail={`Boom-bap loop · ${DEMO.bpm} BPM · works offline`}
          busy={task.busy && picked === 'built-in'}
          disabled={task.busy}
          divided={false}
          onPress={() => add('built-in', addDemoBeat)}
        />
      </View>
    </Screen>
  );
}
