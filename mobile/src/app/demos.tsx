import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { addDemoBeat, addDemoSong } from '@/data/beats';
import { DEMO_GROUPS, DEMO_SONGS } from '@/data/demoSongs';
import type { Project } from '@/data/model';
import { DEMO } from '@/dsp/demoBeat';
import { Eyebrow, Muted, NavLink, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useTask } from '@/ui/hooks';
import { C, clock } from '@/ui/theme';

function Row({ title, detail, busy, disabled, divided, onPress }: { title: string; detail: string; busy: boolean; disabled: boolean; divided: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${title}`}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.row, s.between, { minHeight: 60, gap: 12, opacity: disabled && !busy ? 0.4 : pressed ? 0.7 : 1 }, divided && s.divided]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size={16} w="semi" numberOfLines={1}>
          {title}
        </Txt>
        <Txt size={13} color={C.muted} numberOfLines={1}>
          {detail}
        </Txt>
      </View>
      <Txt size={13} w="semi" color={busy ? C.muted : C.accent}>
        {busy ? 'Loading…' : 'Add'}
      </Txt>
    </Pressable>
  );
}

export default function Demos() {
  const task = useTask();
  const [picked, setPicked] = useState<string | null>(null);

  const add = (id: string, work: () => Promise<Project | null>) => {
    if (task.busy) return;
    setPicked(id);
    void task.run(async () => void ((await work()) && router.replace('/beat')));
  };

  return (
    <Screen gap={22} padBottom={40}>
      <TopBar left="Demo songs" right={<NavLink to="/" back>Close</NavLink>} />
      <Muted>Ready-made beats to freestyle over. Pick one and it lands in your library.</Muted>
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
