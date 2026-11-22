import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';

import type { Library, Project } from '@/data/model';
import { activeBeats, stageOf } from '@/data/songs';

import { Eyebrow, Txt } from './kit';
import { Pop } from './motion';
import { TOP_NAV_HEIGHT } from './tabs';
import { C } from './theme';

const line = { stroke: C.accent, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/**
 * The song that Song, the mic and Mix are showing, named in the top bar. Tapping it lists the
 * beats being worked on, to move to another without going by way of Home.
 */
export function SongSwitcher({ library, beat, left, onPick, onHome }: { library: Library; beat: Project; left: number; onPick: (id: string) => void; onHome: () => void }) {
  const path = usePathname();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  // Going anywhere closes it.
  useEffect(() => setOpen(false), [path]);

  // The beats still being worked on, with the one in view among them even when it is done.
  const active = activeBeats(library.projects);
  const beats = active.some((p) => p.id === beat.id) ? active : [beat, ...active];

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Switch song, now ${beat.name}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        hitSlop={6}
        style={({ pressed }) => ({ flexShrink: 1, minWidth: 0, height: 36, borderRadius: 18, borderWidth: 1, borderColor: open ? C.accent : C.borderStrong, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 14, opacity: pressed ? 0.6 : 1 })}
      >
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <Path d="M9.5 17.5V6.2l9-2v11.3" {...line} />
          <Circle cx={7} cy={17.5} r={2.5} {...line} />
          <Circle cx={16} cy={15.5} r={2.5} {...line} />
        </Svg>
        <Txt size={15} w="semi" numberOfLines={1} style={{ flexShrink: 1 }}>
          {beat.name}
        </Txt>
        <Txt size={11} color={C.muted}>
          {open ? '▴' : '▾'}
        </Txt>
      </Pressable>
      {open && (
        <>
          {/* A tap anywhere else puts the list away. */}
          <Pressable accessibilityLabel="Close the song list" onPress={() => setOpen(false)} style={{ position: 'absolute', top: -200, left: -40, width: 4000, height: height + 400 }} />
          <Pop from="top left" style={{ position: 'absolute', top: TOP_NAV_HEIGHT - 2, left }}>
            <View accessibilityRole="menu" style={{ width: 290, maxWidth: '100%', borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, paddingVertical: 6, boxShadow: '0 12px 32px rgba(0,0,0,0.55)' }}>
              <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
                <Eyebrow>Working on</Eyebrow>
              </View>
              <ScrollView style={{ maxHeight: Math.max(160, height * 0.5) }}>
                {beats.map((p) => {
                  const on = p.id === beat.id;
                  return (
                    <Pressable
                      key={p.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Work on ${p.name}`}
                      accessibilityState={{ selected: on }}
                      onPress={() => (setOpen(false), onPick(p.id))}
                      style={({ pressed }) => ({ minHeight: 52, paddingHorizontal: 16, paddingVertical: 8, justifyContent: 'center', gap: 2, opacity: pressed ? 0.55 : 1 })}
                    >
                      <Txt size={16} w="semi" color={on ? C.accent : C.text} numberOfLines={1}>
                        {p.name}
                      </Txt>
                      <Txt size={13} color={C.muted} numberOfLines={1}>
                        {stageOf(p, library.projects)}
                      </Txt>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable accessibilityRole="link" accessibilityLabel="All beats" onPress={() => (setOpen(false), onHome())} style={({ pressed }) => ({ minHeight: 46, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: C.border, marginTop: 4, opacity: pressed ? 0.55 : 1 })}>
                <Txt size={15} w="medium" color={C.muted}>
                  All beats
                </Txt>
                <Txt size={15} color={C.muted}>
                  ›
                </Txt>
              </Pressable>
            </View>
          </Pop>
        </>
      )}
    </>
  );
}
