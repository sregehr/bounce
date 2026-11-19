import { useEffect, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Layer, Take } from '@/data/model';
import { LAYER_START } from '@/data/model';
import { artistById } from '@/data/artists';
import { activeTake, deleteTake, patchProject, redoSong, setCompBar, setLayers, setLyrics, stacks, undoSong, useLibrary, useProject, useSongHistory } from '@/data/store';
import { barSeconds, compOf, layersOf } from '@/data/studio';
import { useSong } from '@/data/song';
import { NoSong } from '@/ui/AddBeat';
import { BeatCard } from '@/ui/BeatDetails';
import { Btn, Chip, Eyebrow, Muted, NavLink, Screen, Segmented, SliderRow, Txt, s } from '@/ui/kit';
import { useStopOnLeave, useTwoFingerUndo } from '@/ui/hooks';
import { SongUndo, Status, SwipeRow, UndoToast } from '@/ui/parts';
import { SongHeader } from '@/ui/SongHeader';
import { Transport, useRepeat } from '@/ui/Transport';
import { C, F, clock, dayLabel, plural } from '@/ui/theme';
import { Columns, useBar, useGutter, useWide } from '@/ui/wide';

const ROLES = ['Double', 'Ad-lib', 'Hook'] as const;
const ROLE_OF = { Double: 'double', 'Ad-lib': 'adlib', Hook: 'hook' } as const;
const ROLE_LABEL = { double: 'Double', adlib: 'Ad-lib', hook: 'Hook' } as const;
// One colour per take, so a bar borrowed from another take reads at a glance.
const TINTS = ['#ffb020', '#7cc4ff', '#9be28a', '#ff8fb1', '#c9a6ff', '#ffd66b'];

// Height of the pinned next step, above the floating bar.
const NEXT_HEIGHT = 62;

/** The song being worked on: its beat, every take recorded over it, and its lyrics. Picking a take here is what Mix then shapes. */
export default function Song() {
  const project = useProject();
  const take = activeTake(project);
  const repeat = useRepeat();
  const song = useSong(take ? project : null, { autoplay: false, repeat });
  const vaulted = useLibrary((l) => l.projects).filter((p) => p.saved?.from === project?.id).length;
  const library = useLibrary((l) => l);
  const insets = useSafeAreaInsets();
  const gutter = useGutter();
  const tabBar = useBar();
  const [details, setDetails] = useState(false);
  const wide = useWide();
  const history = useSongHistory(project?.id ?? null);
  const projectId = project?.id;
  // On a keyboard, the usual keys undo and redo an edit to the song. In the lyrics they undo typing, as in any text field.
  useEffect(() => {
    if (Platform.OS !== 'web' || !projectId) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || (e.target as HTMLElement | null)?.closest?.('input,textarea')) return;
      e.preventDefault();
      if (e.shiftKey) redoSong(projectId);
      else undoSong(projectId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projectId]);
  useStopOnLeave();
  // A tap with two fingers takes back the last edit to the song.
  useTwoFingerUndo(() => !!projectId && undoSong(projectId));

  // Mastering the beat alone sets the take aside. Back here, the song has its newest take again.
  const newest = project && !project.saved && !take ? project.takes[project.takes.length - 1] : undefined;
  useEffect(() => {
    if (project && newest) patchProject(project.id, { takeId: newest.id }, false);
  }, [project?.id, newest?.id]);

  if (!project || project.saved) return <NoSong title="No song yet" about="A song starts with a beat. Add one and its takes and lyrics live here." />;

  // A take by someone other than the song's artist says whose it is.
  const by = (k: Take) => (k.artistId && k.artistId !== project.artistId ? (artistById(library, k.artistId)?.name ?? null) : null);
  const about = (k: Take) => [by(k), dayLabel(k.createdAt), clock(k.durationSec), k.origin === 'kept' ? 'kept' : k.origin === 'punched' ? 'punched in' : null].filter(Boolean).join(' · ');
  /** Tapping a take picks it and plays it polished over the beat; tapping the picked one plays or pauses. */
  const pick = (k: Take) => {
    if (k.id === take?.id) return song.toggle();
    song.playWhenReady();
    patchProject(project.id, { takeId: k.id }, false);
  };

  const header = (
        <SongHeader project={project}>
          <Status label={project.takes.length ? plural(project.takes.length, 'take') : 'No takes yet'} tone={project.takes.length ? 'plain' : 'todo'} />
          {project.lyrics.trim() ? <Status label="Has lyrics" /> : null}
          <Status label={vaulted === 0 ? 'Not in the Vault yet' : vaulted === 1 ? 'In the Vault' : `${vaulted} in the Vault`} tone={vaulted ? 'good' : 'todo'} />
        </SongHeader>
  );

  const takes = take ? (
          <View>
            <Transport project={project} take={take} song={song} />
            <Txt size={13} color={song.error ? C.recText : C.muted} style={{ paddingTop: 8, paddingBottom: 6 }}>
              {song.error ?? (song.busy ? `Polishing take ${take.number}…` : `Take ${take.number}, polished over the beat`)}
            </Txt>
            {[...project.takes].reverse().map((k) => {
              const on = k.id === take.id;
              return (
                <SwipeRow key={k.id} once label={`Delete take ${k.number}`} onDelete={() => deleteTake(project.id, k.id)}>
                <Pressable accessibilityRole="radio" accessibilityLabel={`Take ${k.number}`} accessibilityState={{ checked: on }} onPress={() => pick(k)} style={[s.row, s.between, { minHeight: 48 }, s.divided]}>
                  <Txt size={15} w="semi" color={on ? C.accent : C.text}>
                    Take {k.number}
                  </Txt>
                  <Txt size={13} color={on ? C.accent : C.muted}>
                    {on ? `${about(k)} · picked` : about(k)}
                  </Txt>
                </Pressable>
                </SwipeRow>
              );
            })}
          </View>
        ) : (
          <Muted>Nothing recorded over this beat yet. Tap the mic below to record a take, and it shows up here.</Muted>
        );

  // More takes stacked on the picked one, and bars of it swapped for bars of another take.
  const others = take ? project.takes.filter((k) => stacks(take, k)) : [];
  const layered = take ? layersOf(project, take) : [];
  const free = others.filter((k) => !layered.some((l) => l.takeId === k.id));
  const swaps = take ? compOf(project, take) : [];
  const bar = barSeconds(project.beat.bpm);
  const bars = take && bar ? Math.min(32, Math.max(1, Math.ceil(Math.max(take.durationSec, ...others.map((k) => k.durationSec)) / bar))) : 0;
  const tint = (k: Take) => TINTS[project.takes.indexOf(k) % TINTS.length];
  const numberOf = (id: string) => project.takes.find((k) => k.id === id)?.number ?? '';
  /** Changes one layer. Dragging its level or pan is one step to undo; `what` names the control. */
  const editLayer = (id: string, patch: Partial<Layer>, what?: 'level' | 'pan') =>
    setLayers(project.id, (all) => all.map((l) => (l.takeId === id ? { ...l, ...patch } : l)), `Changed take ${numberOf(id)}'s ${what ?? 'part'}`, what && `${id}:${what}`);
  const stack = take && others.length > 0 && (
          <View style={{ gap: 14 }}>
            <View style={{ gap: 4 }}>
              <Eyebrow>Layers</Eyebrow>
              <Muted size={13}>Stack other takes on take {take.number}: a double under the lead, ad-libs off to one side, a hook on top.</Muted>
            </View>
            {layered.map((l) => (
              <View key={l.takeId} style={{ gap: 2, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border }}>
                <View style={[s.row, s.between, { gap: 8, minHeight: 40 }]}>
                  <Txt size={15} w="semi">
                    Take {l.take.number}
                  </Txt>
                  <Chip label="Remove" onPress={() => setLayers(project.id, (all) => all.filter((x) => x.takeId !== l.takeId), `Removed the layer of take ${l.take.number}`)} style={{ paddingHorizontal: 12 }} />
                </View>
                <Segmented options={ROLES} value={ROLE_LABEL[l.role]} onChange={(v) => editLayer(l.takeId, { role: ROLE_OF[v], ...LAYER_START[ROLE_OF[v]] })} variant="compact" />
                <SliderRow label={`Take ${l.take.number} level`} value={l.level} display={`${l.level}`} onChange={(level) => editLayer(l.takeId, { level }, 'level')} labelWidth={110} valueWidth={40} />
                <SliderRow label={`Take ${l.take.number} pan`} value={l.pan} min={-100} max={100} step={5} reset={0} display={l.pan === 0 ? 'Centre' : l.pan < 0 ? `L ${-l.pan}` : `R ${l.pan}`} onChange={(pan) => editLayer(l.takeId, { pan }, 'pan')} labelWidth={110} valueWidth={56} />
              </View>
            ))}
            {free.length > 0 && (
              <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
                {free.map((k) => (
                  <Chip key={k.id} label={`Layer take ${k.number}`} onPress={() => setLayers(project.id, (all) => [...all, { takeId: k.id, role: 'double', ...LAYER_START.double }], `Layered take ${k.number}`)} style={{ paddingHorizontal: 14 }} />
                ))}
              </View>
            )}
            {bars > 1 && (
              <View style={{ gap: 8 }}>
                <View style={{ gap: 4 }}>
                  <Eyebrow>Best bars</Eyebrow>
                  <Muted size={13}>Tap a bar to have it play from another take.</Muted>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {Array.from({ length: bars }, (_, i) => {
                    const from = swaps.find((c) => c.bar === i)?.take ?? take;
                    // Each tap moves the bar on to the next take that has it, and round to the picked take again.
                    const order = [take, ...others.filter((k) => k.durationSec > i * (bar ?? 1))];
                    const next = order[(order.indexOf(from) + 1) % order.length];
                    return (
                      <Pressable
                        key={i}
                        accessibilityRole="button"
                        accessibilityLabel={`Bar ${i + 1}, from take ${from.number}`}
                        onPress={() => setCompBar(project.id, i, next.id === take.id ? null : next.id)}
                        style={{ width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: from.id === take.id ? C.dim : tint(from) }}
                      >
                        <Txt size={11} color={from.id === take.id ? C.muted : C.bg}>
                          {i + 1}
                        </Txt>
                        <Txt size={13} w="semi" color={from.id === take.id ? C.text : C.bg}>
                          T{from.number}
                        </Txt>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        );

  const beat = <BeatCard project={project} open={details} onToggle={() => setDetails(!details)} note="The beat by itself" />;

  const lyrics = (
        <View style={[{ gap: 8 }, wide && { flex: 1 }]}>
          <View style={[s.row, s.between, { minHeight: 24 }]}>
            <Eyebrow>Lyrics</Eyebrow>
            {/* Typing is taken back a stretch at a time, right where it was typed. */}
            {history.undo?.kind === 'lyrics' && (
              <NavLink size={13} w="semi" style={{ minHeight: 44, marginVertical: -10 }} onPress={() => undoSong(project.id)}>
                Undo typing
              </NavLink>
            )}
          </View>
          <TextInput
            accessibilityLabel="Lyrics"
            multiline
            value={project.lyrics}
            onChangeText={(text) => setLyrics(project.id, text)}
            placeholder="Write the bars here. They stay with the song when you finish it, and the first line can caption a snippet."
            placeholderTextColor={C.muted}
            selectionColor={C.accent}
            style={[{ minHeight: 120, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, color: C.text, fontFamily: F.regular, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' }, wide && { flex: 1, borderRadius: 18, padding: 20, fontSize: 17, lineHeight: 27 }]}
          />
        </View>
  );

  // Wide: the takes and the beat on the left, the lyrics down the right, and the next step in the header.
  if (wide)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen gap={22}>
        <View style={[s.row, s.between, { alignItems: 'flex-start', gap: 32 }]}>
          <View style={{ flex: 1 }}>{header}</View>
          {take && <Btn label={`Mix take ${take.number}`} to="/playback" style={{ flexGrow: 0, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: 32 }} />}
        </View>
        <Columns
          side={440}
          gap={36}
          left={
            <>
              <SongUndo projectId={project.id} />
              {takes}
              {stack}
              {beat}
            </>
          }
          right={lyrics}
        />
      </Screen>
      <UndoToast projectId={project.id} />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen gap={20}>
        {header}

        <SongUndo projectId={project.id} />

        {takes}

        {stack}

        {/* Until there is a take, the beat is the thing to play, so its card comes first. After that the lyrics do. */}
        {!take && beat}

        {lyrics}

        {take && beat}

        {take && <View style={{ height: NEXT_HEIGHT }} />}
      </Screen>

      {/* The next step stays in reach however far the page is scrolled. Its strip runs down behind the floating bar. */}
      {take && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: tabBar.room + insets.bottom, paddingHorizontal: gutter, paddingTop: 10, backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.border }}>
          <Btn label={`Mix take ${take.number}`} to="/playback" style={{ flex: 0, minHeight: 52 }} />
        </View>
      )}
      <UndoToast projectId={project.id} lift={take ? NEXT_HEIGHT + 4 : 0} />
    </View>
  );
}
