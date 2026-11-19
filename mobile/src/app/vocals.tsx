import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sessionArtist } from '@/data/artists';
import { artistOf } from '@/data/songs';
import type { LoopChoice } from '@/data/model';
import { activeTake, deleteTake, patchProject, setSettings, useLibrary, useProject } from '@/data/store';
import { fileBase } from '@/data/exporting';
import { saveFiles } from '@/data/files';
import { barSeconds, barsIn, getMix, loadPcm, loopSeconds, saveTake } from '@/data/studio';
import { encodeWav } from '@/dsp/wav';
import { engineState, inputAllowed, openInput, play, startTake, stopTake, stopTransport, useEngine, wake } from '@/engine/engine';
import type { RecordedTake } from '@/engine/types';
import { NoSong } from '@/ui/AddBeat';
import { setArtistViewOpen } from '@/ui/artistViewOpen';
import { Btn, Card, Chip, Disclosure, Eyebrow, Muted, NavLink, Option, Pulse, RoundPlay, Screen, SeekTrack, Segmented, StopButton, Txt, s } from '@/ui/kit';
import { MicSetup } from '@/ui/MicSetup';
import { OnTheMic } from '@/ui/OnTheMic';
import { useTiming } from '@/ui/timing';
import { success, thump } from '@/ui/haptics';
import { useArmed, useOnScreen, useRecordingGuard, useTask, useTransport } from '@/ui/hooks';
import { recordState, setRecordControl } from '@/ui/recordControl';
import { SongHeader } from '@/ui/SongHeader';
import { C, clock, meterPct, plural } from '@/ui/theme';
import { useRoomy, useWide } from '@/ui/wide';

const LENGTHS = ['8 bars', '16 bars', 'Whole beat'] as const;
type Length = (typeof LENGTHS)[number];
const toBars = (l: Length): LoopChoice['bars'] => (l === '8 bars' ? 8 : l === '16 bars' ? 16 : 0);
const toLength = (b: LoopChoice['bars']): Length => (b === 8 ? '8 bars' : b === 16 ? '16 bars' : 'Whole beat');

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
  // What was being held when a beat played through to its end while listening: still there to keep.
  const [parked, setParked] = useState<RecordedTake | null>(null);
  // A take that could not be written to storage. It stays here until it is saved, exported or dropped.
  const [unsaved, setUnsaved] = useState<Pending | null>(null);
  const [setup, setSetup] = useState(false);
  // The row of things set once for a session: who is on the mic, punch-in, layers, the count-in, the microphone.
  const [setupOpen, setSetupOpen] = useState(false);
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
  const hearing = useTransport(`booth:${project?.id}`).playing;
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
  const countIn = settings.countIn !== false;
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
    finishing.current = true;
    if (mode === 'recording') thump();
    const wasListening = mode !== 'recording';
    const recorded = mode === 'idle' ? parked : stopTake(true);
    setParked(null);
    const replaces = wasListening ? undefined : (redoing.current ?? undefined);
    redoing.current = null;
    await task.run(async () => {
      if (!recorded) throw new Error(lost ? `${lost} Nothing had been recorded yet.` : 'Nothing was recorded. Check the microphone level and try again.');
      if (recorded.peak < 0.003) throw new Error(lost ? `${lost} What was recorded up to then was silent, so it was not kept.` : 'That take was silent. Check that the right microphone is picked under Microphone and timing, then try again.');
      const layer = !wasListening && !replaces && layering && canLayer;
      await store({ recorded, note: lost, origin: wasListening ? 'kept' : 'recorded', punchAtSec: !wasListening && !layer && !replaces && punch && canPunch && bar ? punchBar * bar : undefined, layer, replaces }, layer ? () => router.push('/song') : then);
      setLayering(false);
    });
    finishing.current = false;
  };

  const retry = () => unsaved && task.run(() => store(unsaved, () => router.push('/playback')));
  const saveAsFile = () =>
    unsaved &&
    project &&
    task.run(async () => {
      const name = await saveFiles([{ name: `${fileBase(project.name)} take.wav`, data: encodeWav([unsaved.recorded.mono], unsaved.recorded.sampleRate, 24), type: 'audio/wav' }]);
      if (!name) throw new Error('This device could not save the file either. Free some space, then try again.');
      setUnsaved(null);
      setSaved(`Saved to your downloads as ${name}. It is not in this song.`);
    });

  // A beat that plays through once ends by itself. A recording is saved; a listen-through is
  // not, but what was held stays in hand so "Keep that" still works.
  useEffect(() => {
    if (!take.ended || mode === 'idle') return;
    if (mode === 'recording') void finish(() => router.push('/playback'));
    else {
      const held = stopTake(true);
      setParked(held && held.peak >= 0.003 ? held : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.ended]);

  // The microphone went away mid-take: unplugged, switched off, muted, or taken by a call. The
  // engine has already stopped the beat. A recording is saved up to that point, and what was
  // held while listening stays in hand, so nothing sung is lost and the artist is told why it stopped.
  useEffect(() => {
    if (!take.lost || mode === 'idle') return;
    if (mode === 'recording') void finish(undefined, LOST[take.lost]);
    else {
      const held = stopTake(true);
      setParked(held && held.peak >= 0.003 ? held : null);
      task.setError(`${LOST[take.lost].replace(', so recording stopped', '')}${held && held.peak >= 0.003 ? ' What was held is still here to keep.' : ''}`);
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
      setParked(null);
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
            <Eyebrow>{loop ? `Loop · bars ${first}–${first + loop.bars - 1}` : 'Whole beat · once through'}</Eyebrow>
            {active && (
              <Txt size={13} w="semi" color={recording ? C.recText : C.accent}>
                {counting ? `Count-in · ${count}` : loop ? `Bar ${first + cell} · pass ${pass}` : clock(take.elapsed)}
              </Txt>
            )}
          </View>
          <View style={[s.row, { gap: 8 }]}>
            {/* While a take is being recorded the record button is what stops it. */}
            <RoundPlay playing={mode === 'listening'} disabled={recording} label={`${mode === 'listening' ? 'Pause' : 'Play'} the ${loop ? 'loop' : 'beat'}`} onPress={() => (mode === 'listening' ? void stopTake(false) : live && void begin('listening'))} />
            <SeekTrack peaks={wave} height={wide ? 64 : 44} progress={active && !counting ? within / span : 0} played={recording ? C.rec : C.accent} disabled onSeek={() => {}} label={loop ? 'Place in the loop' : 'Place in the beat'} duration={span} style={{ flex: 1 }} />
          </View>
          {/* Choosing the bars belongs to whoever runs the session, and waits while a take runs. */}
          {/* It stays where it is while a take runs, dimmed, so the record button below does not move under the thumb. */}
          {!booth && (bar ? <View pointerEvents={active ? 'none' : 'auto'} style={{ opacity: active ? 0.35 : 1 }}><Segmented options={LENGTHS} value={length} onChange={(l) => setLoop({ bars: toBars(l) })} variant="compact" /></View> : <Muted size={13}>Set the tempo in the beat details on the Song tab to loop 8 or 16 bars. Until then the whole beat plays through.</Muted>)}
          {!booth && loop && total > loop.bars && (
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
      ) : (
        // Leaving for Song mid-take would drop the take, so the link waits, in its place.
        <View pointerEvents={active || unsaved ? 'none' : 'auto'} style={{ opacity: active || unsaved ? 0.35 : 1 }}>
          <NavLink size={13} to="/song" style={{ minHeight: 28 }}>
            Write your bars on Song to read them here
          </NavLink>
        </View>
      );

  // One line that says where things stand, readable from a step back.
  const option = layering && canLayer ? `As a layer on take ${previous?.number}` : punch && canPunch ? `Punching in at bar ${first + punchBar}` : null;
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
        {counting ? 'Get ready' : recording ? 'Tap to stop' : (option ?? 'Tap to record')}
      </Txt>
    </View>
  ) : (
    <View style={{ gap: 10 }}>
      <Muted size={15} center>
        {input.error ?? 'Bounce needs a microphone to record your take. It only listens while this screen is open.'}
      </Muted>
      <Btn label="Connect a microphone" busy={input.status === 'opening'} onPress={() => void openInput(settings.inputId, 'mic')} style={{ flex: 0, minHeight: 60 }} />
    </View>
  );

  const canKeep = !task.busy && !unsaved && ((mode === 'listening' && take.held >= 2) || (mode === 'idle' && !!parked));
  // Hearing a take back needs one to exist.
  const canHear = !unsaved && (recording || project.takes.length > 0);
  const hear = () => (recording ? finish(() => router.push('/playback')) : (stopTake(false), router.push('/playback')));

  // What sits under the record button: in the artist view, hearing the take just made, there and then; otherwise the way to the mix, and keeping what was just played.
  const after = !live ? null : booth ? (
    <View style={[s.row, { minHeight: 60, gap: 10 }]}>
      {!recording && (
        <>
          <Btn kind="outline" size={17} label={hearing ? 'Stop playing' : 'Hear the last take'} disabled={task.busy || project.takes.length === 0 || mode === 'listening'} onPress={hearLast} style={{ flex: 1, minHeight: 60, borderRadius: 18 }} />
          {previous && <Btn kind="outline" size={17} label={`Redo take ${previous.number}`} disabled={task.busy} onPress={redo} style={{ flex: 1, minHeight: 60, borderRadius: 18 }} />}
        </>
      )}
    </View>
  ) : (
    <View style={{ gap: 10 }}>
      {(canHear || (previous && !recording)) && (
        <View style={[s.row, { gap: 10 }]}>
          {canHear && <Btn kind={recording ? 'primary' : 'outline'} label={counting ? 'Cancel' : recording ? 'Done, hear it back' : 'Hear it back'} disabled={task.busy} onPress={hear} style={{ flex: 1, minHeight: 56 }} />}
          {/* Another go at the same take: the new one takes its place, instead of adding to the list. */}
          {previous && !recording && !unsaved && <Btn kind="outline" label={`Redo take ${previous.number}`} disabled={task.busy} onPress={redo} style={{ flex: 1, minHeight: 56 }} />}
        </View>
      )}
      {!recording && (
        <View style={[s.row, { minHeight: 56, gap: 12 }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size={15} w="semi">
              Always listening
            </Txt>
            <Txt size={13} color={C.muted}>
              {mode === 'listening'
                ? `Holding the last ${clock(take.held)}. Missed the start?`
                : parked
                  ? `The beat finished. Still holding the last ${clock(parked.mono.length / parked.sampleRate)}.`
                  : `Play the ${loop ? 'loop' : 'beat'} and rap. The last 60 s are held.`}
            </Txt>
          </View>
          <Chip label="Keep that" style={{ paddingHorizontal: 16, borderColor: C.text, opacity: canKeep ? 1 : 0.35 }} onPress={() => canKeep && finish(() => router.push('/playback'))} />
        </View>
      )}
    </View>
  );

  // Shown above the player, where it cannot end up below the fold.
  const message = (task.error || saved || unsaved) && (
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

  // Everything that is set once for a session and then left alone, behind one row.
  const sessionSetup = !booth && !active && !unsaved && (
    <Disclosure title="Session setup" summary={[who ?? 'No one picked', countIn ? 'count-in on' : 'count-in off', live ? `${latencyMs} ms` : null].filter(Boolean).join(' · ')} open={setupOpen} onToggle={() => setSetupOpen(!setupOpen)} last size={15}>
      <View style={{ paddingTop: 4 }}>
        <OnTheMic project={project} />
        {canPunch && (
          <Option label={`Punch in at bar ${first + punchBar}`} sub={`Keeps bars ${first}–${first + punchBar - 1} from take ${previous?.number}`} checked={punch} onChange={(v) => (setPunch(v), v && setLayering(false))} divided minHeight={56} />
        )}
        {live && canLayer && (
          <Option label={`Record as a layer on take ${previous?.number}`} sub="That take plays along. The new one is stacked on it, for doubles and ad-libs." checked={layering} onChange={(v) => (setLayering(v), v && setPunch(false))} divided minHeight={56} />
        )}
        <Option label="Count-in" sub={bar ? 'One bar of clicks before recording starts' : 'Four clicks before recording starts'} checked={countIn} onChange={(v) => setSettings({ countIn: v })} divided minHeight={56} />
        {/* Handing the phone over: this screen with the navigation and the setup put away. */}
        <View style={[s.row, s.between, s.divided, { minHeight: 56, gap: 12 }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size={15} w="semi">
              Artist view
            </Txt>
            <Txt size={13} color={C.muted}>
              For handing the phone over: hides the tabs and this setup, so nothing can be changed by mistake.
            </Txt>
          </View>
          <Chip label="Open artist view" style={{ paddingHorizontal: 16, borderColor: C.text }} onPress={() => (setSaved(null), task.setError(null), setSetupOpen(false), setBooth(true))} />
        </View>
        {live && (
          <Disclosure title="Microphone and timing" summary={`${input.label} · ${latencyMs} ms ${timing.measured ? 'measured' : 'estimated'}`} open={setup} onToggle={() => setSetup(!setup)} last size={15}>
            <MicSetup />
          </Disclosure>
        )}
      </View>
    </Disclosure>
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
    const body = (
      <View style={{ flex: 1, flexDirection: 'row', gap: 40, minHeight: 0 }}>
        {lyrics}
        <View style={{ width: 420, gap: 16 }}>
          {message}
          {player}
          {status}
          {meter}
          {recordButton}
          {after}
          {micNote}
          {sessionSetup}
        </View>
      </View>
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

  const column = (
    <>
      {header}
      {message}
      {player}
      {lyrics}
      {status}
      {meter}
      {recordButton}
      {after}
      {micNote}
      {sessionSetup}
    </>
  );
  // The artist view fills the screen with the navigation put away; otherwise the page scrolls above the bar as the other tabs do.
  return booth ? <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[{ flexGrow: 1, gap: big ? 20 : 14 }, pad]}>{column}</ScrollView> : <Screen gap={14}>{column}</Screen>;
}
