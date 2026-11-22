import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';

import { importAudio, importBeat } from '@/data/beats';
import { beatsIn } from '@/data/songs';
import { useLibrary } from '@/data/store';

import { useTask } from './hooks';
import { Btn, Eyebrow, Muted, NavLink, Screen, Txt, go, s, type Nav } from './kit';
import { C } from './theme';
import { useWide } from './wide';

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

/**
 * In a browser, an audio file dropped anywhere on the page is handed over, as if it had been
 * picked. This is how a beat comes across from Files in Split View on a tablet. The native app
 * has no drop target yet.
 */
function useFileDrop(onFile: (file: File) => void) {
  const latest = useRef(onFile);
  latest.current = onFile;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      latest.current(file);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}

/**
 * The three ways to bring a beat in, as a row of tiles. Home leads with it while there is no beat, and so does any
 * screen with no song to show. With `fold`, for a Home that already has beats, it is one "New beat" button that opens the tiles;
 * on a phone that button is a link in the heading of the list, and this stays mounted under it so a dropped file is still caught.
 */
export function AddBeat({ fold, open: shown, onOpen }: { fold?: boolean; /** Given, the tiles are opened from somewhere else, and folded it shows nothing. */ open?: boolean; onOpen?: (open: boolean) => void }) {
  const [own, setOwn] = useState(false);
  const led = shown !== undefined;
  const open = shown ?? own;
  const setOpen = (next: boolean) => (onOpen ? onOpen(next) : setOwn(next));
  const any = useLibrary((l) => beatsIn(l.projects).length > 0);
  const task = useTask();
  const add = () => task.run(async () => void ((await importBeat()) && router.push('/song')));
  const wide = useWide();
  useFileDrop((file) => !task.busy && task.run(async () => void ((await importAudio(file.name, file)) && router.push('/song'))));
  // An import that is running or has failed keeps the tiles in view, so its progress and its error are seen.
  if (fold && !open && !task.busy && !task.error) return led ? null : <Btn kind="outline" label="New beat" onPress={() => setOpen(true)} style={{ flex: 0 }} />;
  return (
    <View style={{ gap: 10 }}>
      {/* Opened from a heading elsewhere, that heading is its title and holds the way to close it. */}
      {!led && (
      <View style={[s.row, s.between, { minHeight: 20 }]}>
        <Eyebrow>{fold ? 'New beat' : 'Add a beat'}</Eyebrow>
        {fold && (
          <NavLink tone="quiet" size={13} w="semi" style={{ minHeight: 44, marginVertical: -12 }} onPress={() => setOpen(false)}>
            Close
          </NavLink>
        )}
      </View>
      )}
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
      {wide && Platform.OS === 'web' && !task.error && <Muted size={13}>Or drop an audio file anywhere on this page.</Muted>}
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
