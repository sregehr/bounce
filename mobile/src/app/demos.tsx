import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { addDemoBeat, addDemoSong } from '@/data/beats';
import { DEMO_GROUPS, DEMO_SONGS, type DemoSong } from '@/data/demoSongs';
import type { Project } from '@/data/model';
import { DEMO, makeDemoBeat } from '@/dsp/demoBeat';
import { decode, play, stopTransport, toggle } from '@/engine/engine';
import { Chip, Eyebrow, Muted, RoundPlay, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useStopOnLeave, useTask, useTransport } from '@/ui/hooks';
import { asSheet } from '@/ui/nav';
import { useRowLines } from '@/ui/type';
import { C, clock } from '@/ui/theme';
import { Columns, useWide } from '@/ui/wide';

/** One demo: a button to hear it first, and the rest of the row adds it. */
function Row({ id, title, detail, busy, disabled, divided, onPress, load, roomy }: { id: string; title: string; detail: string; busy: boolean; disabled: boolean; divided: boolean; onPress: () => void; load: () => Promise<Pcm>; /** The wide layout's taller row and bigger play button. */ roomy?: boolean }) {
  const height = roomy ? 68 : 60;
  const tid = `demo:${id}`;
  const t = useTransport(tid);
  const preview = useTask();
  // With large text a title wraps instead of being cut short; the row grows to fit.
  const lines = useRowLines();
  const onPreview = () => {
    if (t.loaded) return toggle();
    void preview.run(async () => play(tid, { a: await load() }));
  };
  return (
    <View style={[s.row, { minHeight: height, gap: roomy ? 14 : 12 }, divided && s.divided]}>
      <RoundPlay size={roomy ? 44 : 36} icon={13} playing={t.playing} onPress={onPreview} disabled={preview.busy || disabled} label={t.playing ? `Pause ${title}` : `Preview ${title}`} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${title}`}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [s.row, s.between, { flex: 1, minHeight: height, gap: 12, paddingVertical: lines > 1 ? 8 : 0, opacity: disabled && !busy ? 0.4 : pressed ? 0.7 : 1 }]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Txt size={16} w="semi" numberOfLines={lines}>
            {title}
          </Txt>
          <Txt size={13} color={preview.error ? C.recText : C.muted} numberOfLines={lines}>
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

const FILTERS = [...DEMO_GROUPS, 'Built in'] as const;

function Demos() {
  const task = useTask();
  const [picked, setPicked] = useState<string | null>(null);
  const wide = useWide();
  // Only the wide layout filters; the phone lists every group.
  const [group, setGroup] = useState<(typeof FILTERS)[number]>(FILTERS[0]);
  useStopOnLeave();

  const add = (id: string, work: () => Promise<Project | null>) => {
    if (task.busy) return;
    setPicked(id);
    stopTransport();
    void task.run(async () => void ((await work()) && router.replace('/song')));
  };

  const title = <TopBar back left="Demo songs" />;
  const intro = <Muted>Ready-made beats to freestyle over. Play one to hear it first; tap its name to add it to your library.</Muted>;
  const error = task.error && (
    <Txt size={13} color={C.recText}>
      {task.error}
    </Txt>
  );

  const songRow = (song: DemoSong, divided: boolean) => (
    <Row
      key={song.id}
      id={song.id}
      load={() => demoAudio(song.id, song.title)}
      title={song.title}
      detail={`${song.style} · ${Math.round(song.bpm)} BPM · ${clock(song.seconds)}`}
      busy={task.busy && picked === song.id}
      disabled={task.busy}
      divided={divided}
      roomy={wide}
      onPress={() => add(song.id, () => addDemoSong(song))}
    />
  );
  const builtInRow = (
    <Row
      key="built-in"
      id="built-in"
      load={builtIn}
      title={DEMO.name}
      detail={`Boom-bap loop · ${DEMO.bpm} BPM · works offline`}
      busy={task.busy && picked === 'built-in'}
      disabled={task.busy}
      divided={wide}
      roomy={wide}
      onPress={() => add('built-in', addDemoBeat)}
    />
  );

  // Wide: one group at a time, picked from a row of chips, with its songs in two columns that read across.
  if (wide) {
    const rows = group === 'Built in' ? [builtInRow] : DEMO_SONGS.filter((song) => song.group === group).map((song) => songRow(song, true));
    return (
      <Screen gap={22}>
        {title}
        {intro}
        {error}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {FILTERS.map((name) => (
            <Chip key={name} label={name} on={name === group} onPress={() => setGroup(name)} style={{ paddingHorizontal: 18 }} />
          ))}
        </View>
        <Columns inner={0} left={rows.filter((_, i) => i % 2 === 0)} right={rows.filter((_, i) => i % 2 === 1)} />
      </Screen>
    );
  }

  return (
    <Screen gap={22} padBottom={40}>
      {title}
      {intro}
      {error}

      {DEMO_GROUPS.map((group) => {
        const songs = DEMO_SONGS.filter((song) => song.group === group);
        return (
          <View key={group}>
            <Eyebrow>{group}</Eyebrow>
            {songs.map((song, i) => songRow(song, i < songs.length - 1))}
          </View>
        );
      })}

      <View>
        <Eyebrow>Built in</Eyebrow>
        {builtInRow}
      </View>
    </Screen>
  );
}

// A sheet over Home.
export default asSheet(Demos);
