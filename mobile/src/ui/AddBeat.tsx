import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';

import { importBeat } from '@/data/beats';
import { beatsIn } from '@/data/songs';
import { useLibrary } from '@/data/store';

import { useTask } from './hooks';
import { Eyebrow, Muted, Screen, Txt, go, s, type Nav } from './kit';
import { C } from './theme';

const stroke = { stroke: C.accent, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

const ICONS = {
  // A record dot in its ring.
  capture: (
    <>
      <Circle cx={12} cy={12} r={9} {...stroke} />
      <Circle cx={12} cy={12} r={4} fill={C.accent} />
    </>
  ),
  // An arrow dropping into a tray.
  file: <Path d="M12 3v11m0 0l-4-4m4 4l4-4M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" {...stroke} />,
  // A note.
  demo: (
    <>
      <Path d="M9 18V5l11-2v13" {...stroke} />
      <Circle cx={6.5} cy={18} r={2.5} {...stroke} />
      <Circle cx={17.5} cy={16} r={2.5} {...stroke} />
    </>
  ),
} satisfies Record<string, ReactNode>;

/** One of the ways to start a song, as a tile in the row at the top of Home. `name` is what it is called in full. */
function Create({ icon, label, name, busy, disabled, ...nav }: Nav & { icon: keyof typeof ICONS; label: string; name: string; busy?: boolean; disabled?: boolean }) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={() => go(nav)}
      style={({ pressed }) => ({ flex: 1, minHeight: 84, borderRadius: 18, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 6, opacity: off ? 0.4 : pressed ? 0.8 : 1 })}
    >
      {busy ? (
        <ActivityIndicator color={C.text} style={{ height: 24 }} />
      ) : (
        <Svg width={24} height={24} viewBox="0 0 24 24">
          {ICONS[icon]}
        </Svg>
      )}
      <Txt size={14} w="semi" center numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** The three ways to bring a beat in, as a row of tiles. Home leads with it, and so does any screen with no song to show. */
export function AddBeat() {
  const any = useLibrary((l) => beatsIn(l.projects).length > 0);
  const task = useTask();
  const add = () => task.run(async () => void ((await importBeat()) && router.push('/beat')));
  return (
    <View style={{ gap: 10 }}>
      <Eyebrow>Add a beat</Eyebrow>
      <View style={[s.row, { gap: 10 }]}>
        <Create icon="capture" label="Capture" name="Capture from your gear" to="/capture" disabled={task.busy} />
        <Create icon="file" label="Import" name="Import a file" busy={task.busy} onPress={add} />
        <Create icon="demo" label="Demos" name={any ? 'Add a demo song' : 'Try a demo song'} to="/demos" disabled={task.busy} />
      </View>
      {task.error && (
        <Txt size={13} color={C.recText}>
          {task.error}
        </Txt>
      )}
    </View>
  );
}

/** What Song, the mic and Mix show when there is no beat to work on yet: why, and the ways to add one. */
export function NoSong({ title, about }: { title: string; about: string }) {
  return (
    <Screen gap={20}>
      <View style={{ gap: 6, paddingTop: 8 }}>
        <Txt size={26} w="display">
          {title}
        </Txt>
        <Muted size={15}>{about}</Muted>
      </View>
      <AddBeat />
    </Screen>
  );
}
