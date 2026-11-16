import { useEffect, useRef, useState, type RefObject } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useBackup } from '@/data/backup';
import { CoverImage } from '@/cover/CoverImage';
import type { Project } from '@/data/model';
import { songLead, songsIn } from '@/data/songs';
import { deleteProject, openSong, setCurrent, useLibrary } from '@/data/store';
import { Btn, Eyebrow, Field, Foot, Muted, NavLink, PlayIcon, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useStopOnLeave, useTransport } from '@/ui/hooks';
import { Scrubber, SkipPlay, useNowPlaying } from '@/ui/NowPlaying';
import { C, clock, dayLabel, lufs } from '@/ui/theme';
import { useWide } from '@/ui/wide';

const meta = (p: Project) => [p.artist?.trim() || null, dayLabel(p.saved?.at ?? p.createdAt), clock(p.stats?.durationSec ?? p.beat.durationSec), p.takes.length ? null : 'instrumental'].filter(Boolean).join(' · ');
const tag = (p: Project) => [p.overrides.master ? 'Mastered by hand' : `Mastered · ${p.master.style}`, p.stats ? lufs(p.stats.lufs, 0) : null, p.snippet.made ? 'Snippet made' : null, p.lyrics.trim() ? 'Has lyrics' : null].filter(Boolean).join(' · ');

// The docked player in the wide layout, and the cover inside it.
const DOCK = 372;
const DOCK_PAD = 28;

/** A card's tag line; the open song's says whether it is playing. The id is the one `useSong` puts on the transport. */
function OpenTag({ id, tag: line }: { id: string; tag: string }) {
  const { playing } = useTransport(`song:${id}`);
  return <>{`${playing ? 'Playing' : 'Last played'} · ${line}`}</>;
}

/**
 * The open song, playing beside the list in the wide layout. It is mounted once per song, so
 * leaving the Vault, opening another song or removing this one stops it.
 */
function Docked({ project, autoplay, open, toggle, sure, onRemove }: { project: Project; autoplay: boolean; open: (id: string) => void; toggle: RefObject<(() => void) | null>; sure: boolean; onRemove: () => void }) {
  const now = useNowPlaying(project, { autoplay, open });
  const { song } = now;
  useStopOnLeave();

  // Tapping the open song's card in the list plays or pauses it.
  useEffect(() => {
    toggle.current = song.toggle;
    return () => {
      toggle.current = null;
    };
  });

  // The screens these lead to work on the current song, which may have moved on to a beat since this one was opened.
  const go = (to: Href) => {
    openSong(project.id);
    router.push(to);
  };

  return (
    <>
      <Pressable accessibilityRole="link" accessibilityLabel="Open the player full screen" onPress={() => go('/player')}>
        <CoverImage project={project} size={DOCK - 2 * DOCK_PAD} radius={22} />
        <View style={{ position: 'absolute', top: 16, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={18} height={18} viewBox="0 0 20 20" fill="none">
            <Path d="M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6" stroke={C.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
      </Pressable>

      <View style={{ gap: 4 }}>
        <Txt size={26} w="display" numberOfLines={1}>
          {project.name}
        </Txt>
        <Txt size={14} color={C.muted} numberOfLines={1}>
          {song.error ?? now.credit}
        </Txt>
        <Pressable accessibilityRole="link" accessibilityLabel="Mastering settings" onPress={() => go('/master')} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Txt size={12} w="semi" ls={0.08} upper color={song.error ? C.recText : C.muted}>
            {now.mastering}
          </Txt>
        </Pressable>
      </View>

      <Scrubber now={now} />
      <SkipPlay now={now} size={68} />

      <Foot gap={6}>
        <View style={[s.row, { gap: 10 }]}>
          <Btn kind="outline" label="Snippet" onPress={() => go('/snippet')} style={{ flex: 1, borderRadius: 14 }} />
          <Btn kind="outline" label="Share" onPress={() => go('/export')} style={{ flex: 1, borderRadius: 14 }} />
        </View>
        <View style={[s.row, { justifyContent: now.beat ? 'space-between' : 'flex-end' }]}>
          {now.beat && (
            <NavLink size={14} onPress={now.again}>
              {now.againLabel}
            </NavLink>
          )}
          <NavLink size={14} onPress={onRemove}>
            {sure ? 'Sure?' : 'Remove'}
          </NavLink>
        </View>
      </Foot>
    </>
  );
}

/** Finished songs: the ones saved from a beat's song page, ready to play, share and promote. */
export default function Vault() {
  const library = useLibrary((l) => l);
  const backup = useBackup();
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const wide = useWide();
  const insets = useSafeAreaInsets();
  // Wide: the song a tap in the list asked to hear, which starts by itself once it is ready; the one found open when arriving waits for play.
  const [asked, setAsked] = useState<string | null>(null);
  const toggle = useRef<(() => void) | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const all = songsIn(library.projects);
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((p) => `${p.name} ${meta(p)} ${tag(p)} ${p.lyrics} ${p.snippet.caption}`.toLowerCase().includes(q)) : all;

  const open = (p: Project) => {
    openSong(p.id);
    router.push('/player');
  };
  // Wide: the song stays in the Vault and plays in the panel beside the list.
  const docked = all.find((p) => p.id === library.songId);
  const play = (id: string) => {
    setAsked(id);
    openSong(id);
  };
  const remove = (p: Project) => {
    if (removing !== p.id) return setRemoving(p.id);
    setRemoving(null);
    void deleteProject(p.id);
  };
  // With nothing finished yet, the Vault points at the step that gets a song here.
  const next = songLead(library);
  const start = () => {
    if (next.id) setCurrent(next.id);
    router.push(next.to);
  };

  const empty =
        all.length === 0 ? (
          <View style={{ gap: 14, paddingVertical: 8 }}>
            <Txt size={22} w="display">
              Nothing finished yet
            </Txt>
            <Muted>The Vault holds your finished songs: the ones you want to play, share and promote. Pick a take on the Song tab, shape it in Mix, then tap Finish song.</Muted>
            <Btn label={next.to === '/song' ? 'Open your song' : 'Add a beat'} onPress={start} style={{ flex: 0 }} />
          </View>
        ) : (
          shown.length === 0 && (
            <View style={{ paddingVertical: 20 }}>
              <Muted size={13}>{`Nothing in the vault matches “${query}”.`}</Muted>
            </View>
          )
        );

  const foot = (
      <Foot gap={12}>
        <Muted size={13}>
          {all.length > 0 ? 'Removing a song here leaves its beat and takes where they are. ' : ''}
          {backup.status === 'done' ? 'Everything is backed up.' : backup.status === 'working' ? `Backing up${backup.pending ? ` (${backup.pending} left)` : ''}…` : backup.status === 'unreachable' ? 'Backup server not reachable; your work is safe on this device.' : backup.status === 'off' ? 'Backup is off.' : ''}
        </Muted>
      </Foot>
  );

  // Wide: the songs as a grid of covers, and the open one playing in a panel docked on the right.
  if (wide) {
    const column = 18;
    const cell = Math.floor((gridWidth - 2 * column) / 3);
    return (
      <Screen scroll={false} gap={0} style={{ flexDirection: 'row', paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, gap: 22, paddingTop: Math.max(36, insets.top + 16), paddingRight: all.length ? 32 : insets.right + 40, paddingBottom: Math.max(28, insets.bottom + 12) }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TopBar
            left="Vault"
            right={
              all.length > 0 && (
                <View style={{ width: 320 }}>
                  <Field label="Search your songs" value={query} onChangeText={setQuery} placeholder="Search: a title, a style, a line" returnKeyType="search" autoCorrect={false} />
                </View>
              )
            }
          />

          <View onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: column, rowGap: 22 }}>
            {cell > 0 &&
              shown.map((p) => {
                const on = p.id === docked?.id;
                return (
                  <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Play ${p.name}`} accessibilityState={{ selected: on }} onPress={() => (on && toggle.current ? toggle.current() : play(p.id))} style={{ width: cell, gap: 10 }}>
                    {/* The open song's cover is ringed. */}
                    <View style={{ borderWidth: 3, borderRadius: 21, borderColor: on ? C.text : C.bg }}>
                      <CoverImage project={p} size={cell - 6} radius={18} />
                    </View>
                    <View style={{ gap: 3 }}>
                      <Txt size={16} w="semi" numberOfLines={1}>
                        {p.name}
                      </Txt>
                      <Txt size={13} color={C.muted} numberOfLines={1}>
                        {meta(p)}
                      </Txt>
                      <Txt size={12} w="semi" color={C.accent} numberOfLines={1}>
                        {on ? <OpenTag id={p.id} tag={tag(p)} /> : tag(p)}
                      </Txt>
                    </View>
                  </Pressable>
                );
              })}
          </View>
          {empty && <View style={{ maxWidth: 520 }}>{empty}</View>}

          {foot}
        </ScrollView>

        {all.length > 0 && (
          <ScrollView
            accessibilityLabel="Now playing"
            style={{ flexGrow: 0, width: DOCK + insets.right, backgroundColor: C.surface, borderLeftWidth: 1, borderLeftColor: C.border }}
            contentContainerStyle={{ flexGrow: 1, gap: 16, paddingLeft: DOCK_PAD, paddingRight: DOCK_PAD + insets.right, paddingTop: Math.max(DOCK_PAD, insets.top + 12), paddingBottom: Math.max(DOCK_PAD, insets.bottom + 12) }}
            showsVerticalScrollIndicator={false}
          >
            {docked ? (
              <Docked key={docked.id} project={docked} autoplay={asked === docked.id} open={play} toggle={toggle} sure={removing === docked.id} onRemove={() => remove(docked)} />
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', gap: 8 }}>
                <Txt size={22} w="display" center>
                  Pick a song
                </Txt>
                <Muted center>Tap one in the list and it plays here.</Muted>
              </View>
            )}
          </ScrollView>
        )}
      </Screen>
    );
  }

  return (
    <Screen gap={16}>
      <TopBar left="Vault" />

      {all.length > 0 && (
        <View style={{ gap: 6 }}>
          <Eyebrow>Search your songs</Eyebrow>
          <Field label="Search your songs" value={query} onChangeText={setQuery} placeholder="A title, a style, a line" returnKeyType="search" autoCorrect={false} />
        </View>
      )}

      <View>
        {shown.map((p) => (
          <View key={p.id} style={[s.row, s.divided, { gap: 12, minHeight: 84 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${p.name}`} onPress={() => open(p)} style={[s.row, { flex: 1, gap: 14, minHeight: 84 }]}>
              <View>
                <CoverImage project={p} size={52} radius={10} />
                {library.songId === p.id && (
                  <View style={{ position: 'absolute', right: -6, bottom: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
                    <PlayIcon size={10} color={C.bg} />
                  </View>
                )}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Txt size={16} w="semi" numberOfLines={1}>
                  {p.name}
                </Txt>
                <Txt size={13} color={C.muted} numberOfLines={1}>
                  {meta(p)}
                </Txt>
                <Txt size={12} w="semi" color={C.accent} numberOfLines={1}>
                  {library.songId === p.id ? `Last played · ${tag(p)}` : tag(p)}
                </Txt>
              </View>
            </Pressable>
            <NavLink size={13} onPress={() => remove(p)} style={{ minHeight: 36 }}>
              {removing === p.id ? 'Sure?' : 'Remove'}
            </NavLink>
          </View>
        ))}
        {empty}
      </View>

      {foot}
    </Screen>
  );
}
