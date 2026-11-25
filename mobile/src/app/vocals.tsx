import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sessionArtist } from '@/data/artists';
import { artistOf } from '@/data/songs';
import type { LoopChoice } from '@/data/model';
import { activeTake, deleteTake, patchProject, setProfile, setSettings, useLibrary, useProject } from '@/data/store';
import { fileBase } from '@/data/exporting';
import { saveFiles } from '@/data/files';
import { barSeconds, barsIn, getMix, loadPcm, loopSeconds, saveTake } from '@/data/studio';
import { encodeWav } from '@/dsp/wav';
import { engineState, inputAllowed, openInput, play, startTake, stopTake, stopTransport, useEngine, wake } from '@/engine/engine';
import type { RecordedTake } from '@/engine/types';
import { NoSong } from '@/ui/AddBeat';
import { setArtistViewOpen } from '@/ui/artistViewOpen';
import { Btn, Card, Chip, Disclosure, Eyebrow, Field, Muted, NavLink, Pulse, RoundPlay, Screen, SeekTrack, Segmented, StopButton, TopBar, Txt, s } from '@/ui/kit';
import { NATIVE, reduceMotion } from '@/ui/motion';
import { OnTheMic } from '@/ui/OnTheMic';
import { MicSetup } from '@/ui/MicSetup';
import { useTiming } from '@/ui/timing';
import { WindowTrack } from '@/ui/WindowTrack';
import { success, thump } from '@/ui/haptics';
import { useArmed, useOnScreen, useRecordingGuard, useTask, useTransport } from '@/ui/hooks';
import { recordState, setRecordControl } from '@/ui/recordControl';
import { SongHeader } from '@/ui/SongHeader';
import { C, clock, meterPct, plural } from '@/ui/theme';
import { useRoomy, useWide } from '@/ui/wide';

const RECORD_TABS = ['Record', 'Lyrics'] as const;
const LENGTHS = ['8 bars', '16 bars', 'Whole beat'] as const;
type Length = (typeof LENGTHS)[number];
const toBars = (l: Length): LoopChoice['bars'] => (l === '8 bars' ? 8 : l === '16 bars' ? 16 : 0);
const toLength = (b: LoopChoice['bars']): Length => (b === 8 ? '8 bars' : b === 16 ? '16 bars' : 'Whole beat');
// What the next take is: one more in the list, a new second half for the picked take, or a layer stacked on it.
type TakeMode = 'New take' | 'Punch in' | 'Layer';

/** A row that leads one step further in: its name, what is set there now, and a chevron. */
function Drill({ title, summary, onPress }: { title: string; summary: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${summary}`} onPress={onPress} style={({ pressed }) => [s.row, s.between, { minHeight: 56, gap: 12, borderTopWidth: 1, borderTopColor: C.line, borderBottomWidth: 1, borderBottomColor: C.line, opacity: pressed ? 0.6 : 1 }]}>
      <Txt size={15} w="semi">
        {title}
      </Txt>
      <View style={[s.row, { gap: 8, flexShrink: 1 }]}>
        <Txt size={13} color={C.muted} numberOfLines={1} style={{ flexShrink: 1 }}>
          {summary}
        </Txt>
        <Txt size={20} color={C.muted} lh={1}>
          ›
        </Txt>
      </View>
    </Pressable>
  );
}

/** A page stepping in from the right as it is opened. With motion reduced it only fades. */
function SlideIn({ children }: { children: ReactNode }) {
  const at = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(at, { toValue: 1, duration: reduceMotion() ? 100 : 200, useNativeDriver: NATIVE }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The page is clipped while it moves, so it never makes the screen wider than it is.
  return (
    <View style={{ overflow: 'hidden' }}>
      <Animated.View style={{ gap: 14, opacity: at, transform: [{ translateX: reduceMotion() ? 0 : at.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] }}>{children}</Animated.View>
    </View>
  );
}

/** A recording on its way into the song, with what is needed to store it. */
type Pending = { recorded: RecordedTake; origin: 'kept' | 'recorded'; punchAtSec?: number; layer?: boolean; note?: string; /** The take this one is a redo of, which it takes the place of once it is saved. */ replaces?: { id: string; number: number } };
/** What to say when the microphone goes away in the middle of a take. */
const LOST = { disconnected: 'The microphone was disconnected, so recording stopped.', muted: 'The microphone was muted, so recording stopped.' };

export default function Vocals() {
  const project = useProject();
  const settings = useLibrary((l) => l.settings);
  const input = useEngine((e) => e.input);
  const take = useEngine((e) => e.take);
  const task = useTask();
  const [punch, setPunch] = useState(false);
  // Recording on top of the picked take: it plays along with the beat, and the new take joins it as a layer.
  const [layering, setLayering] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // The number of the take just saved, while what `saved` says is about it: it is then shown as a card that plays it, not a line of text.
  const [madeNumber, setMadeNumber] = useState<number | null>(null);
  // A take that could not be written to storage. It stays here until it is saved, exported or dropped.
  const [unsaved, setUnsaved] = useState<Pending | null>(null);
  // Which page of this screen is showing: recording, or the session's setup one step in.
  const [page, setPage] = useState<'record' | 'setup' | 'mic'>('record');
  // On a phone, a song with lyrics has them on a tab of their own, with a small record button under them.
  const [tab, setTab] = useState<(typeof RECORD_TABS)[number]>('Record');
  const finishing = useRef(false);
  // Set while a take is being redone: the take the new one will replace.
  const redoing = useRef<{ id: string; number: number } | null>(null);
  const [dropArmed, armDrop, disarmDrop] = useArmed();
  const [onScreen, setOnScreen] = useState(false);
  // The artist view: this screen as the person at the mic needs it, with the navigation put away.
  const [booth, setBooth] = useState(false);
  const inBooth = useRef(false);
  inBooth.current = booth;
  const who = useLibrary((l) => sessionArtist(l)?.name ?? null);
  const ownName = useLibrary((l) => l.profile.artist);
  // The name is asked for once, here, after the first take: it is not needed before there is something to put it on.
  const nameAsked = useLibrary((l) => !!l.profile.nameAsked);
  const [nameDraft, setNameDraft] = useState('');
  const heard = useTransport(`booth:${project?.id}`);
  const hearing = heard.playing;
  useEffect(() => {
    setArtistViewOpen(booth && onScreen);
    return () => setArtistViewOpen(false);
  }, [booth, onScreen]);
  const live = input.status === 'ready';
  const mode = take.mode;
  const wide = useWide();
  const roomy = useRoomy();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  useOnScreen(() => {
    void inputAllowed().then((ok) => void (ok && engineState().input.status !== 'ready' && openInput(settings.inputId, 'mic')));
    if (project) void loadPcm(project.beat.key).catch(() => {});
    setOnScreen(true);
    // Coming back from elsewhere, such as the guided setup, lands on recording again.
    setPage('record');
    return () => {
      setOnScreen(false);
      setRecordControl(null);
      // Leaving mid-take drops it, the same as the capture screen.
      stopTake(false);
    };
  });

  const loop = project ? loopSeconds(project.beat, project.loop) : null;
  const bar = barSeconds(project?.beat.bpm ?? null);
  const total = project ? barsIn(project.beat) : 0;
  const previous = activeTake(project);
  const span = loop ? loop.end - loop.start : (project?.beat.durationSec ?? 1);
  const cells = loop ? loop.bars : 16;
  const canPunch = !!loop && !!bar && !!previous && previous.phaseSec < 0.001 && previous.loop.bars === project?.loop.bars && previous.loop.startBar === project?.loop.startBar;
  const punchBar = loop ? Math.floor(loop.bars / 2) : 0;
  // A layer has to line up with the picked take bar for bar, so it is recorded over the same stretch.
  const canLayer = !!previous && previous.phaseSec < 0.001 && previous.loop.bars === project?.loop.bars && previous.loop.startBar === project?.loop.startBar;
  const timing = useTiming();
  const latencyMs = timing.ms;
  // One bar of clicks before recording, at the beat's tempo when it is known.
  // Every take starts with a count-in; an older setting that turned it off is no longer read.
  const countIn = true;
  const beatSec = bar ? bar / 4 : 0.5;
  const counting = mode === 'recording' && take.lead > 0;
  const count = counting ? Math.max(1, Math.ceil(take.lead / beatSec - 0.05)) : 0;

  useRecordingGuard(mode === 'recording' || !!unsaved);
  // A take that could not be saved needs the owner: what to do with it is on the full screen.
  useEffect(() => {
    if (unsaved) setBooth(false);
  }, [unsaved]);

  /** Writes a recording into the song. If storage refuses it, the recording is kept in hand. */
  const store = async (pending: Pending, then?: () => void) => {
    if (!project) return;
    let made;
    try {
      made = await saveTake(project.id, pending.recorded, { latencyMs, origin: pending.origin, punchAtSec: pending.punchAtSec, layer: pending.layer ? 'adlib' : undefined });
    } catch {
      setUnsaved(pending);
      throw new Error('That take could not be saved. Storage on this device may be full. It is still here.');
    }
    setUnsaved(null);
    if (!made) throw new Error('That take was too short to keep.');
    // A redo takes the place of the take it redid, once it is safely in. Undo on the Song tab brings the old one back.
    if (pending.replaces) deleteTake(project.id, pending.replaces.id);
    success();
    setMadeNumber(made.number);
    setSaved(`${pending.note ? `${pending.note} ` : ''}Take ${made.number} saved${pending.layer ? ' as a layer' : pending.replaces ? ` in place of take ${pending.replaces.number}` : ''} · ${clock(made.durationSec)}${made.clipped ? ' · the mic clipped, back off a little' : ''}`);
    setPunch(false);
    // In the artist view a saved take stays on this screen: the mix is the owner's to open.
    if (!inBooth.current) then?.();
  };

  // `lost` is why the microphone went away, when that is what ended the take.
  const finish = async (then?: () => void, lost?: string) => {
    if (!project || finishing.current) return;
    // Stopped during the count-in: nothing has been recorded yet, so it is simply called off.
    if (counting) {
      redoing.current = null;
      stopTake(false);
      if (lost) task.setError(`${lost} Nothing had been recorded yet.`);
      return;
    }
    // Only a take being recorded is saved. Playing the beat to hear it keeps nothing.
    if (mode !== 'recording') return void stopTake(false);
    finishing.current = true;
    thump();
    const recorded = stopTake(true);
    const replaces = redoing.current ?? undefined;
    redoing.current = null;
    await task.run(async () => {
      if (!recorded) throw new Error(lost ? `${lost} Nothing had been recorded yet.` : 'Nothing was recorded. Check the microphone level and try again.');
      if (recorded.peak < 0.003) throw new Error(lost ? `${lost} What was recorded up to then was silent, so it was not kept.` : 'That take was silent. Check that the right microphone is picked under Mic and timing, then try again.');
      const layer = !replaces && layering && canLayer;
      await store({ recorded, note: lost, origin: 'recorded', punchAtSec: !layer && !replaces && punch && canPunch && bar ? punchBar * bar : undefined, layer, replaces }, layer ? () => router.push('/song') : then);
      setLayering(false);
    });
    finishing.current = false;
  };

  const retry = () => unsaved && task.run(() => store(unsaved));
  const saveAsFile = () =>
    unsaved &&
    project &&
    task.run(async () => {
      const name = await saveFiles([{ name: `${fileBase(project.name)} take.wav`, data: encodeWav([unsaved.recorded.mono], unsaved.recorded.sampleRate, 24), type: 'audio/wav' }]);
      if (!name) throw new Error('This device could not save the file either. Free some space, then try again.');
      setUnsaved(null);
      setMadeNumber(null);
      setSaved(`Saved to your downloads as ${name}. It is not in this song.`);
    });

  // A beat that plays through once ends by itself. A recording is saved; a listen-through just stops.
  useEffect(() => {
    if (!take.ended || mode === 'idle') return;
    // Like a take stopped by hand, it stays on this screen, where it can be played, mixed or redone.
    if (mode === 'recording') void finish();
    else stopTake(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.ended]);

  // The microphone went away mid-take: unplugged, switched off, muted, or taken by a call. The
  // engine has already stopped the beat. A recording is saved up to that point, so nothing sung
  // is lost, and the artist is told why it stopped.
  useEffect(() => {
    if (!take.lost || mode === 'idle') return;
    if (mode === 'recording') void finish(undefined, LOST[take.lost]);
    else {
      stopTake(false);
      task.setError(LOST[take.lost].replace(', so recording stopped', ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.lost]);

  // While a take runs, or one is waiting to be saved, the navigation steps aside: it is told so here.
  const control = recordState(live, mode);
  useEffect(() => {
    if (onScreen && project) setRecordControl({ state: control, busy: task.busy || !!unsaved, holding: !!unsaved });
  }, [onScreen, !!project, control, task.busy, !!unsaved]);

  if (!project || project.saved) return <NoSong title="Nothing to record over yet" about="Add a beat, then come back here and rap over it." />;

  const begin = (next: 'listening' | 'recording', plain = false) =>
    task.run(async () => {
      wake();
      if (next === 'recording') thump();
      setSaved(null);
      setMadeNumber(null);
      // A take being played back here gives way to the beat.
      stopTransport();
      if (mode !== 'idle') stopTake(false);
      const stacking = next === 'recording' && !plain && layering && canLayer;
      // For a layer the picked take plays too, mixed as it is now, once through from its start.
      const beat = stacking ? await getMix(project) : await loadPcm(project.beat.key);
      await startTake(next, beat, loop && !stacking ? { start: loop.start, end: loop.end } : null, next === 'recording' && countIn ? { beats: 4, beatSec } : undefined);
    });

  /** The record button on this screen: starts a take, or stops the one running. */
  const record = () => {
    // A take that is still waiting to be saved comes first: recording again would replace it.
    if (task.busy || unsaved) return;
    if (mode === 'recording') return void finish();
    redoing.current = null;
    if (live) void begin('recording');
  };

  /** Records the picked take again. The new one takes its place; it is a plain take, not a layer or a punch-in. */
  const redo = () => {
    if (task.busy || unsaved || !live || !previous || mode === 'recording') return;
    redoing.current = { id: previous.id, number: previous.number };
    setLayering(false);
    setPunch(false);
    void begin('recording', true);
  };

  /** Plays the take just made, mixed as the song is now, or stops it. For the artist view, which stays on this screen. */
  const hearLast = () =>
    hearing
      ? stopTransport()
      : task.run(async () => {
          wake();
          const mix = await getMix(project);
          await play(`booth:${project.id}`, { a: { channels: mix.channels, sampleRate: mix.sampleRate }, autoplay: true });
        });

  const active = mode !== 'idle';
  const recording = mode === 'recording';
  const within = active ? take.elapsed % span : 0;
  const cell = active && !counting ? Math.min(cells - 1, Math.floor((within / span) * cells)) : -1;
  const pass = Math.floor(take.elapsed / span) + 1;
  // The beat under the loop, for drawing: the slice of its waveform that the bars cover.
  const beatWave = project.beat.wave;
  const wave = loop && project.beat.durationSec > 0 ? beatWave.slice(Math.floor((loop.start / project.beat.durationSec) * beatWave.length), Math.max(1, Math.ceil((loop.end / project.beat.durationSec) * beatWave.length))) : beatWave;
  const first = (loop?.startBar ?? 0) + 1;
  // Which bars the next take is recorded over. Takes already made keep the bars they were recorded over.
  const setLoop = (patch: Partial<LoopChoice>) => !active && patchProject(project.id, { loop: { ...project.loop, ...patch } }, false);
  const length = toLength(project.loop.bars);
  // The loop can sit elsewhere in the beat when the beat is longer than it. Where it sits is the session owner's choice.
  const movable = !booth && !!loop && !!bar && total > loop.bars;
  const lead = loop ? loop.start - loop.startBar * (bar ?? 0) : 0;
  /** The bar a loop would start on, for a place in the beat (0–1): the nearest fourth bar that leaves room for the loop. */
  const barAt = (f: number) => (loop && bar ? Math.max(0, Math.min(total - loop.bars, Math.round((f * project.beat.durationSec - lead) / bar / 4) * 4)) : 0);
  const big = wide || roomy;
  const button = big ? 168 : booth ? 148 : 124;

  // The artist view is this same screen, handed to whoever is at the mic: their name in place of the song's details.
  const header = booth ? (
    <View style={[s.row, s.between, { gap: 16, minHeight: 56 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size={big ? 40 : 28} w="display" ls={-0.02} lh={1.1} numberOfLines={1}>
          {who ?? artistOf(project, { artist: ownName })}
        </Txt>
        <Txt size={big ? 17 : 15} color={C.muted} numberOfLines={1}>
          {project.name}
        </Txt>
      </View>
      {/* Leaving mid-take would drop the take, so the way out waits for it to end. */}
      {!recording && <Chip label="Exit artist view" onPress={() => (stopTransport(), stopTake(false), setBooth(false))} style={{ paddingHorizontal: 16, minHeight: 48, borderRadius: 24 }} />}
    </View>
  ) : (
    <SongHeader project={project} locked={active || !!unsaved} />
  );

  // The same player as the Song and Mix tabs, over the stretch of the beat the take is recorded on, with the choice of that stretch under it.
  const player = live && (
        <Card style={wide ? { padding: 20, gap: 14, borderRadius: 24 } : { padding: 16, gap: 12 }}>
          <View style={[s.row, s.between]}>
            <Eyebrow>{loop ? `Loop · bars ${first}–${first + loop.bars - 1}${movable ? ` of ${total}` : ''}` : 'Whole beat · once through'}</Eyebrow>
            {movable && !active && <Muted size={13}>Drag to move</Muted>}
            {active && (
              <Txt size={13} w="semi" color={recording ? C.recText : C.accent}>
                {counting ? `Count-in · ${count}` : loop ? `Bar ${first + cell} · pass ${pass}` : clock(take.elapsed)}
              </Txt>
            )}
          </View>
          <View style={[s.row, { gap: 8 }]}>
            {/* While a take is being recorded the record button is what stops it. */}
            <RoundPlay playing={mode === 'listening'} disabled={recording} label={`${mode === 'listening' ? 'Pause' : 'Play'} the ${loop ? 'loop' : 'beat'}`} onPress={() => (mode === 'listening' ? void stopTake(false) : live && void begin('listening'))} />
            {movable && !active && loop && bar ? (
              // At rest the whole beat is drawn, with the loop as a window on it that drags to another stretch, four bars at a time.
              <View style={{ flex: 1 }}>
                <WindowTrack
                  peaks={beatWave}
                  height={wide ? 64 : 44}
                  from={loop.start / project.beat.durationSec}
                  span={(loop.end - loop.start) / project.beat.durationSec}
                  snap={(f) => (lead + barAt(f) * bar) / project.beat.durationSec}
                  onMove={(f) => setLoop({ startBar: barAt(f) })}
                  label="Where the loop sits in the beat"
                  say={(f) => `Bars ${barAt(f) + 1} to ${barAt(f) + loop.bars} of ${total}`}
                />
              </View>
            ) : (
              <SeekTrack peaks={wave} height={wide ? 64 : 44} progress={active && !counting ? within / span : 0} played={recording ? C.rec : C.accent} disabled onSeek={() => {}} label={loop ? 'Place in the loop' : 'Place in the beat'} duration={span} style={{ flex: 1 }} />
            )}
          </View>
          {/* Choosing the bars belongs to whoever runs the session, and waits while a take runs. */}
          {/* It stays where it is while a take runs, dimmed, so the record button below does not move under the thumb. */}
          {!booth && (bar ? <View pointerEvents={active ? 'none' : 'auto'} style={{ opacity: active ? 0.35 : 1 }}><Segmented options={LENGTHS} value={length} onChange={(l) => setLoop({ bars: toBars(l) })} variant="compact" /></View> : <Muted size={13}>Set the tempo in the beat details on the Song tab to loop 8 or 16 bars. Until then the whole beat plays through.</Muted>)}
          {movable && loop && (
            <View pointerEvents={active ? 'none' : 'auto'} style={[s.row, s.between, { opacity: active ? 0.35 : 1 }]}>
              <NavLink size={13} style={{ minHeight: 28 }} onPress={() => setLoop({ startBar: Math.max(0, loop.startBar - 4) })}>
                Start 4 bars earlier
              </NavLink>
              <NavLink size={13} style={{ minHeight: 28 }} onPress={() => setLoop({ startBar: Math.min(total - loop.bars, loop.startBar + 4) })}>
                Start 4 bars later
              </NavLink>
            </View>
          )}
          {project.loop.bars > total && bar && !active ? <Muted size={13}>This beat is {plural(total, 'bar')} long, so that is what loops.</Muted> : null}
        </Card>
      );

  // The words, big enough to read from a step back.
  const lyricSize = big ? (booth ? 34 : 26) : booth ? 26 : 20;
  const lyrics = project.lyrics.trim() ? (
        <View style={[{ borderRadius: 24, borderWidth: 1, borderColor: C.border, padding: big ? 24 : 16, gap: 8 }, wide && { flex: 1, minHeight: 320, maxHeight: Math.max(320, height - 190) }]}>
          <View style={[s.row, s.between, { minHeight: 24 }]}>
            <Eyebrow>Your bars</Eyebrow>
            {/* Leaving for Song mid-take would drop the take, so the way there waits. */}
            {wide && !booth && !active && !unsaved && (
              <NavLink size={14} to="/song" style={{ minHeight: 24 }}>
                Edit on Song
              </NavLink>
            )}
          </View>
          <ScrollView nestedScrollEnabled style={wide ? { flex: 1 } : { maxHeight: Math.max(120, Math.min(booth ? 320 : 220, height * (booth ? 0.34 : 0.24))) }} showsVerticalScrollIndicator={false}>
            <Txt size={lyricSize} lh={1.45}>
              {project.lyrics}
            </Txt>
          </ScrollView>
        </View>
      ) : wide ? (
        <View style={{ flex: 1, minHeight: 320, borderRadius: 24, borderWidth: 1, borderColor: C.border, padding: 24, gap: 8 }}>
          <Eyebrow>Your bars</Eyebrow>
          <Muted size={15}>{booth ? 'No lyrics written for this song. Freestyle it.' : 'No bars written yet. Write them on the Song tab and they show here, big enough to read while you rap.'}</Muted>
        </View>
      ) : booth ? (
        <Muted size={17}>No lyrics written for this song. Freestyle it.</Muted>
      ) : // With no lyrics the recording screen says nothing about them: they are added on the Song tab.
      null;

  const toMix = () => (stopTransport(), stopTake(false), router.push('/playback'));

  // A take just saved takes the loop's place: it plays here, and from here it goes to the mix or is done again.
  // In the artist view the take is heard from the buttons under the record button instead.
  const result = !!saved && madeNumber !== null && previous?.number === madeNumber && !booth && !active && !unsaved && !task.error;
  const resultCard = result && previous && (
    <Card style={[{ borderColor: C.accent }, wide ? { padding: 20, gap: 14, borderRadius: 24 } : { padding: 16, gap: 12 }]}>
      <View accessibilityRole="alert" style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
        <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: C.accent }} />
        <Txt size={15} w="semi" lh={1.4} style={{ flex: 1 }}>
          {saved}
        </Txt>
      </View>
      <View style={[s.row, { gap: 8 }]}>
        <RoundPlay playing={hearing} disabled={task.busy} label={hearing ? `Stop take ${previous.number}` : `Play take ${previous.number}`} onPress={hearLast} />
        <SeekTrack peaks={previous.wave} height={wide ? 64 : 44} progress={heard.duration > 0 ? heard.position / heard.duration : 0} disabled onSeek={() => {}} label={`Place in take ${previous.number}`} duration={previous.durationSec} style={{ flex: 1 }} />
      </View>
      <View style={[s.row, { gap: 10 }]}>
        <Btn label="Mix it" disabled={task.busy} onPress={toMix} style={{ flex: 1, minHeight: 52 }} />
        <Btn kind="outline" label="Redo" disabled={task.busy || !live} onPress={redo} style={{ flex: 1, minHeight: 52 }} />
      </View>
      <View style={[s.row, s.between, { gap: 12 }]}>
        <Muted size={13} style={{ flex: 1 }}>
          Plays here, polished over the beat. Redo replaces take {previous.number}.
        </Muted>
        <NavLink tone="quiet" size={13} w="semi" style={{ minHeight: 44, marginVertical: -8 }} onPress={() => (stopTransport(), setSaved(null), setMadeNumber(null))}>
          Back to the loop
        </NavLink>
      </View>
    </Card>
  );

  // One line that says where things stand, readable from a step back.
  const option = layering && canLayer ? `As a layer on take ${previous?.number}, which plays along` : punch && canPunch ? `Punching in at bar ${first + punchBar} of take ${previous?.number}` : null;
  // What the next take is, chosen right above the button that records it. Only the kinds that can be made over this loop are offered.
  const kinds: TakeMode[] = ['New take', ...(canPunch ? (['Punch in'] as const) : []), ...(canLayer ? (['Layer'] as const) : [])];
  const kind: TakeMode = layering && canLayer ? 'Layer' : punch && canPunch ? 'Punch in' : 'New take';
  const takeMode = live && !booth && !unsaved && kinds.length > 1 && (
    // It stays where it is while a take runs, dimmed, so the record button below does not move under the thumb.
    <View pointerEvents={active ? 'none' : 'auto'} style={{ gap: 8, opacity: active ? 0.35 : 1 }}>
      <Eyebrow>{madeNumber ? 'Next take' : 'This take'}</Eyebrow>
      <Segmented options={kinds} value={kind} onChange={(k) => (setPunch(k === 'Punch in'), setLayering(k === 'Layer'))} variant="compact" />
    </View>
  );
  const status = (
    <View accessibilityRole="alert" style={[s.row, { justifyContent: 'center', gap: 14, minHeight: big ? 84 : 56 }]}>
      {recording && <Pulse size={16} color={C.rec} on={!counting} />}
      <Txt size={counting ? (big ? 84 : 56) : recording ? (big ? 64 : 48) : big ? 26 : 20} w="display" lh={1} center style={{ fontVariant: ['tabular-nums'], flexShrink: 1 }}>
        {counting ? count : recording ? clock(take.elapsed) : !live ? 'No microphone yet' : mode === 'listening' ? 'The beat is playing' : project.takes.length ? 'Ready for another take' : 'Ready when you are'}
      </Txt>
    </View>
  );

  const meter = live && (
        <View accessible={false} style={{ height: big ? 10 : 6, borderRadius: 5, backgroundColor: C.line, overflow: 'hidden' }}>
          <View style={{ width: `${meterPct(active ? take.level : Math.max(input.levelL, input.levelR))}%`, height: big ? 10 : 6, backgroundColor: take.clipped && active ? C.rec : C.text }} />
        </View>
      );

  // Recording starts and stops here, on the screen, with one large button. The mic in the navigation only leads to this screen.
  const recordButton = live ? (
    <View style={{ alignItems: 'center', gap: 8 }}>
      {/* The button keeps its place when the take starts, so the tap that stops it lands where the one that started it did. */}
      <View style={{ height: button + 20, justifyContent: 'center' }}>
        <StopButton size={button} halo={recording} recording={recording} disabled={task.busy || !!unsaved} label={recording ? 'Stop recording' : 'Start recording'} onPress={record} />
      </View>
      <Txt size={big ? 19 : 16} w="semi" color={C.muted} center>
        {counting ? 'Get ready · tap to cancel' : recording ? (booth ? 'Tap to stop' : 'Tap to stop. The take is saved for you.') : (option ?? (result ? 'Record another' : 'Tap to record'))}
      </Txt>
    </View>
  ) : (
    <View style={{ gap: 10 }}>
      <Muted size={15} center>
        {input.error ?? 'Bounce needs a microphone to record your take. It only listens while this screen is open. Wear headphones, so the beat stays out of the mic.'}
      </Muted>
      <Btn label="Connect a microphone" busy={input.status === 'opening'} onPress={() => void openInput(settings.inputId, 'mic')} style={{ flex: 0, minHeight: 60 }} />
    </View>
  );

  // What sits under the record button: in the artist view, hearing the take just made, there and then; otherwise the way to the mix, and redoing the take.
  const after = !live ? null : booth ? (
    <View style={[s.row, { minHeight: 60, gap: 10 }]}>
      {!recording && (
        <>
          <Btn kind="outline" size={17} label={hearing ? 'Stop playing' : 'Hear the last take'} disabled={task.busy || project.takes.length === 0 || mode === 'listening'} onPress={hearLast} style={{ flex: 1, minHeight: 60, borderRadius: 18 }} />
          {previous && <Btn kind="outline" size={17} label={`Redo take ${previous.number}`} disabled={task.busy} onPress={redo} style={{ flex: 1, minHeight: 60, borderRadius: 18 }} />}
        </>
      )}
    </View>
  ) : previous && !active && !unsaved && !result ? (
    // Coming back to a song that has takes: the way to its mix, and another go at the picked take.
    <View style={[s.row, { gap: 10 }]}>
      <Btn kind="outline" label={`Mix take ${previous.number}`} disabled={task.busy} onPress={toMix} style={{ flex: 1, minHeight: 56 }} />
      {/* Another go at the same take: the new one takes its place, instead of adding to the list. */}
      <Btn kind="outline" label={`Redo take ${previous.number}`} disabled={task.busy} onPress={redo} style={{ flex: 1, minHeight: 56 }} />
    </View>
  ) : null;

  // Shown above the player, where it cannot end up below the fold.
  const message = (task.error || (saved && !result) || unsaved) && (
        <View accessibilityRole="alert" style={{ gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: task.error || unsaved ? C.rec : C.accent, backgroundColor: C.surface }}>
          <Txt size={14} w="medium" color={task.error || unsaved ? C.recText : C.accent}>
            {task.error ?? saved ?? 'A take is waiting to be saved.'}
          </Txt>
          {unsaved && (
            <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
              <Chip label="Try again" on onPress={() => !task.busy && retry()} style={{ paddingHorizontal: 16 }} />
              <Chip label="Save as a file" onPress={() => !task.busy && saveAsFile()} style={{ paddingHorizontal: 16, borderColor: C.text }} />
              <Chip label={dropArmed ? 'Tap again to discard' : 'Discard'} onPress={() => (dropArmed ? (setUnsaved(null), task.setError(null), disarmDrop()) : armDrop())} style={{ paddingHorizontal: 16 }} />
            </View>
          )}
        </View>
      );

  // Everything that is set once for a session and then left alone is one step in from this screen.
  const summary = who ?? 'No one picked';
  const sessionSetup = !booth && !active && !unsaved && <Drill title="On the mic" summary={summary} onPress={() => setPage('setup')} />;

  // Which microphone records and how far takes are moved to land on the beat stay one tap from here, measured or not.
  // Timing starts from an estimate for whatever is connected, and the row says so until it has been checked.
  // It sits flush under the session row, sharing the line between them.
  const timingRow = !booth && !active && !unsaved && <View style={{ marginTop: wide ? -17 : -15 }}><Drill title="Mic and timing" summary={timing.measured ? `${latencyMs} ms, measured` : `${latencyMs} ms, estimated · Check it`} onPress={() => setPage('mic')} /></View>;

  const saveName = (name: string) => setProfile(name.trim() ? { artist: name.trim(), nameAsked: true } : { nameAsked: true });
  const askName = !ownName.trim() && !nameAsked && project.takes.length > 0 && !booth && !active && !unsaved && (
    <Card style={{ padding: 16, gap: 10 }}>
      <View style={{ gap: 4 }}>
        <Txt size={17} w="display" ls={0}>
          What do you go by?
        </Txt>
        <Muted size={13}>Your name goes on the player and on snippets you share. You can change it in your profile.</Muted>
      </View>
      <Field label="Artist name" value={nameDraft} onChangeText={setNameDraft} placeholder="Your name or alias" maxLength={40} autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => saveName(nameDraft)} />
      <View style={[s.row, { gap: 10 }]}>
        <Btn kind="outline" label="Save name" disabled={!nameDraft.trim()} onPress={() => saveName(nameDraft)} style={{ flex: 1 }} />
        <NavLink tone="quiet" size={14} onPress={() => saveName('')} style={{ minHeight: 44, paddingHorizontal: 8 }}>
          Not now
        </NavLink>
      </View>
    </Card>
  );

  if (page !== 'record' && !booth && !active && !unsaved)
    return (
      <Screen gap={14}>
        <SlideIn key={page}>
          {page === 'setup' ? (
            <>
              <TopBar back={{ onBack: () => setPage('record'), label: 'Back to recording' }} left="On the mic" />
              <OnTheMic project={project} />
              {/* Handing the phone over: the recording screen with the navigation and this setup put away. */}
              <View style={[s.row, s.between, s.divided, { minHeight: 56, gap: 12, paddingVertical: 8 }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size={15} w="semi">
                    Artist view
                  </Txt>
                  <Txt size={13} color={C.muted}>
                    For handing the phone over: hides the tabs and this setup, so nothing can be changed by mistake.
                  </Txt>
                </View>
                <Chip label="Open artist view" style={{ paddingHorizontal: 16, borderColor: C.text }} onPress={() => (setSaved(null), task.setError(null), setPage('record'), setBooth(true))} />
              </View>
            </>
          ) : (
            <>
              {/* The same controls as in Settings, here where a take that sits early or late is noticed. */}
              <TopBar back={{ onBack: () => setPage('record'), label: 'Back to recording' }} left="Mic and timing" />
              <MicSetup />
            </>
          )}
        </SlideIn>
      </Screen>
    );

  const micNote = active ? (
    <Muted size={13} center>
      Mic: {input.label}. Timing is corrected by {latencyMs} ms.
    </Muted>
  ) : input.muted ? (
    <Txt size={13} color={C.recText} center>
      The microphone is muted, so a take would be silent. Unmute it, or end the call that is using it.
    </Txt>
  ) : null;

  const pad = booth ? { paddingTop: Math.max(20, insets.top + 12), paddingBottom: Math.max(24, insets.bottom + 16), paddingLeft: insets.left + (big ? 40 : 20), paddingRight: insets.right + (big ? 40 : 20) } : null;

  // Wide: the words down the left, and the player, the record button and the setup beside them.
  if (wide) {
    const hasWords = project.lyrics.trim().length > 0;
    const recorder = (
      <View style={{ width: 420, gap: 16 }}>
        {message}
        {resultCard || player}
        {status}
        {takeMode}
        {meter}
        {recordButton}
        {after}
        {micNote}
        {sessionSetup}
        {timingRow}
        {askName}
      </View>
    );
    // Words down the left when the song has them; without any, the recorder has the middle of the screen to itself.
    const body = hasWords ? (
      <View style={{ flex: 1, flexDirection: 'row', gap: 40, minHeight: 0 }}>
        {lyrics}
        {recorder}
      </View>
    ) : (
      <View style={{ flex: 1, alignItems: 'center' }}>{recorder}</View>
    );
    return booth ? (
      <View style={[{ flex: 1, backgroundColor: C.bg, gap: 20 }, pad]}>
        {header}
        {body}
      </View>
    ) : (
      <Screen gap={20}>
        {header}
        {body}
      </Screen>
    );
  }

  // In the artist view the words stay on the one screen, for whoever is at the mic. Otherwise, on a phone, they are a tab.
  const hasLyrics = project.lyrics.trim().length > 0;
  const tabbed = !booth && hasLyrics;
  const onLyrics = tabbed && tab === 'Lyrics';
  const column = (
    <>
      {header}
      {message}
      {tabbed && <Segmented options={RECORD_TABS} value={tab} onChange={setTab} />}
      {onLyrics ? (
        <>
          <View style={{ borderRadius: 24, borderWidth: 1, borderColor: C.border, padding: 16 }}>
            <ScrollView nestedScrollEnabled style={{ maxHeight: Math.max(160, height - 520) }} showsVerticalScrollIndicator={false}>
              <Txt size={22} lh={1.45}>
                {project.lyrics}
              </Txt>
            </ScrollView>
          </View>
          {/* The take can be started and stopped from here too, so the words stay in view while it runs. */}
          {live ? (
            <View style={[s.row, { gap: 16, justifyContent: 'center', minHeight: 96 }]}>
              <StopButton size={76} halo={recording} recording={recording} disabled={task.busy || !!unsaved} label={recording ? 'Stop recording' : 'Start recording'} onPress={record} />
              <Txt size={recording && !counting ? 32 : 17} w={recording ? 'display' : 'semi'} color={recording ? C.text : C.muted} style={{ fontVariant: ['tabular-nums'], minWidth: 120 }}>
                {counting ? `Get ready · ${count}` : recording ? clock(take.elapsed) : (option ?? 'Tap to record')}
              </Txt>
            </View>
          ) : (
            recordButton
          )}
          {meter}
        </>
      ) : (
        <>
          {resultCard || player}
          {!tabbed && lyrics}
          {status}
          {takeMode}
          {meter}
          {recordButton}
          {after}
          {micNote}
          {sessionSetup}
          {timingRow}
          {askName}
        </>
      )}
    </>
  );
  // The artist view fills the screen with the navigation put away; otherwise the page scrolls above the bar as the other tabs do.
  return booth ? <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[{ flexGrow: 1, gap: big ? 20 : 14 }, pad]}>{column}</ScrollView> : <Screen gap={14}>{column}</Screen>;
}
