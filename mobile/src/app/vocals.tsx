import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';

import type { LoopChoice } from '@/data/model';
import { activeTake, patchProject, useLibrary, useProject } from '@/data/store';
import { fileBase } from '@/data/exporting';
import { saveFiles } from '@/data/files';
import { barSeconds, barsIn, loadPcm, loopSeconds, saveTake } from '@/data/studio';
import { encodeWav } from '@/dsp/wav';
import { engineState, inputAllowed, openInput, startTake, stopTake, useEngine, wake } from '@/engine/engine';
import type { RecordedTake } from '@/engine/types';
import { NoSong } from '@/ui/AddBeat';
import { Btn, Card, Chip, Disclosure, Eyebrow, Foot, Muted, NavLink, Option, Screen, Segmented, Txt, s } from '@/ui/kit';
import { MicSetup } from '@/ui/MicSetup';
import { useTiming } from '@/ui/timing';
import { useArmed, useOnScreen, useRecordingGuard, useTask } from '@/ui/hooks';
import { askForMic, setRecordControl } from '@/ui/recordControl';
import { SongHeader } from '@/ui/SongHeader';
import { C, clock, meterPct, plural } from '@/ui/theme';
import { Columns, useWide } from '@/ui/wide';

const LENGTHS = ['8 bars', '16 bars', 'Whole beat'] as const;
type Length = (typeof LENGTHS)[number];
const toBars = (l: Length): LoopChoice['bars'] => (l === '8 bars' ? 8 : l === '16 bars' ? 16 : 0);
const toLength = (b: LoopChoice['bars']): Length => (b === 8 ? '8 bars' : b === 16 ? '16 bars' : 'Whole beat');
/** A recording on its way into the song, with what is needed to store it. */
type Pending = { recorded: RecordedTake; origin: 'kept' | 'recorded'; punchAtSec?: number };

export default function Vocals() {
  const project = useProject();
  const settings = useLibrary((l) => l.settings);
  const input = useEngine((e) => e.input);
  const take = useEngine((e) => e.take);
  const task = useTask();
  const [punch, setPunch] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // What was being held when a beat played through to its end while listening: still there to keep.
  const [parked, setParked] = useState<RecordedTake | null>(null);
  // A take that could not be written to storage. It stays here until it is saved, exported or dropped.
  const [unsaved, setUnsaved] = useState<Pending | null>(null);
  const [setup, setSetup] = useState(false);
  const finishing = useRef(false);
  const [dropArmed, armDrop, disarmDrop] = useArmed();
  const [onScreen, setOnScreen] = useState(false);
  const live = input.status === 'ready';
  const mode = take.mode;
  const wide = useWide();
  const { height } = useWindowDimensions();

  useOnScreen(() => {
    void inputAllowed().then((ok) => void (ok && engineState().input.status !== 'ready' && openInput(settings.inputId, 'mic')));
    if (project) void loadPcm(project.beat.key).catch(() => {});
    setOnScreen(true);
    return () => {
      setOnScreen(false);
      setRecordControl(null);
      askForMic(false);
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
  const timing = useTiming();
  const latencyMs = timing.ms;

  useRecordingGuard(mode === 'recording' || !!unsaved);

  /** Writes a recording into the song. If storage refuses it, the recording is kept in hand. */
  const store = async (pending: Pending, then?: () => void) => {
    if (!project) return;
    let made;
    try {
      made = await saveTake(project.id, pending.recorded, { latencyMs, origin: pending.origin, punchAtSec: pending.punchAtSec });
    } catch {
      setUnsaved(pending);
      throw new Error('That take could not be saved. Storage on this device may be full. It is still here.');
    }
    setUnsaved(null);
    if (!made) throw new Error('That take was too short to keep.');
    setSaved(`Take ${made.number} saved · ${clock(made.durationSec)}${made.clipped ? ' · the mic clipped, back off a little' : ''}`);
    setPunch(false);
    then?.();
  };

  const finish = async (then?: () => void) => {
    if (!project || finishing.current) return;
    finishing.current = true;
    const wasListening = mode !== 'recording';
    const recorded = mode === 'idle' ? parked : stopTake(true);
    setParked(null);
    await task.run(async () => {
      if (!recorded) throw new Error('Nothing was recorded. Check the microphone level and try again.');
      if (recorded.peak < 0.003) throw new Error('That take was silent. Check that the right microphone is picked under Microphone and timing, then try again.');
      await store({ recorded, origin: wasListening ? 'kept' : 'recorded', punchAtSec: !wasListening && punch && canPunch && bar ? punchBar * bar : undefined }, then);
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

  // The mic in the bottom bar is the record button while this screen is open: with no
  // microphone yet it offers to connect one, and otherwise it starts and stops the take.
  const press = useRef(() => {});
  const control = !live ? 'off' : mode === 'recording' ? 'recording' : 'ready';
  useEffect(() => {
    if (onScreen && project) setRecordControl({ state: control, busy: task.busy, press: () => press.current() });
  }, [onScreen, !!project, control, task.busy]);

  if (!project || project.saved) return <NoSong title="Nothing to record over yet" about="Add a beat, then come back here and rap over it." />;

  const begin = (next: 'listening' | 'recording') =>
    task.run(async () => {
      wake();
      setSaved(null);
      setParked(null);
      if (mode !== 'idle') stopTake(false);
      const beat = await loadPcm(project.beat.key);
      await startTake(next, beat, loop ? { start: loop.start, end: loop.end } : null);
    });

  press.current = () => {
    // A take that is still waiting to be saved comes first: recording again would replace it.
    if (task.busy || unsaved) return;
    if (!live) return askForMic(true);
    if (mode === 'recording') void finish();
    else void begin('recording');
  };

  const active = mode !== 'idle';
  const within = active ? take.elapsed % span : 0;
  const cell = active ? Math.min(cells - 1, Math.floor((within / span) * cells)) : -1;
  const pass = Math.floor(take.elapsed / span) + 1;
  const setLoop = (patch: Partial<LoopChoice>) => !active && patchProject(project.id, { loop: { ...project.loop, ...patch } }, false);
  const length = toLength(project.loop.bars);
  const first = (loop?.startBar ?? 0) + 1;

  const header = <SongHeader project={project} locked={active} />;

  // The same empty state as Mix: what is missing, and one button that starts it.
  const empty = !active && project.takes.length === 0 && (
        <View style={{ gap: 12 }}>
          <View style={{ gap: 4 }}>
            <Txt size={17} w="semi">
              No takes yet
            </Txt>
            <Muted size={15}>Record one over this beat and it opens in the mix.</Muted>
          </View>
          <Btn label="Record a take" disabled={task.busy} onPress={() => press.current()} />
        </View>
      );

  // Looping and listening both play the beat against the microphone, so they wait for one.
  const loopCard = live && (
        <Card style={wide ? { padding: 22, gap: 16, borderRadius: 24 } : { padding: 16, gap: 12 }}>
          <View style={[s.row, s.between]}>
            <Eyebrow>{loop ? `Loop · bars ${first}–${first + loop.bars - 1}` : 'Whole beat · once through'}</Eyebrow>
            {active ? (
              <Txt size={13} w="semi" color={mode === 'recording' ? C.recText : C.accent}>
                {loop ? `Bar ${first + cell} · pass ${pass}` : clock(take.elapsed)}
              </Txt>
            ) : (
              <NavLink size={13} w="semi" style={{ minHeight: 24 }} onPress={() => live && begin('listening')}>
                {loop ? 'Play the loop' : 'Play the beat'}
              </NavLink>
            )}
          </View>
          <View accessible={false} style={{ flexDirection: 'row', gap: wide ? 6 : 3 }}>
            {Array.from({ length: cells }, (_, i) => (
              <View key={i} style={[{ flex: 1, height: 34, borderRadius: 4, backgroundColor: !active ? C.dim : i < cell ? C.text : i === cell ? (mode === 'recording' ? C.rec : C.accent) : C.dim }, wide && { height: 130, borderRadius: 10, justifyContent: 'flex-end', padding: cells > 8 ? 6 : 10 }]}>
                {wide && loop ? (
                  <Txt size={cells > 8 ? 14 : 18} w="display" ls={0} color={active && i <= cell ? C.bg : C.muted}>
                    {first + i}
                  </Txt>
                ) : null}
              </View>
            ))}
          </View>
          {bar ? (
            <Segmented options={LENGTHS} value={length} onChange={(l) => setLoop({ bars: toBars(l) })} variant="inset" />
          ) : (
            <Muted size={13}>Set the tempo in the beat details on the Song tab to loop 8 or 16 bars. Until then the whole beat plays through.</Muted>
          )}
          {loop && total > loop.bars && !active && (
            <View style={[s.row, s.between]}>
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

  const punchIn = canPunch && (
        <Option
          label={`Punch in at bar ${first + punchBar}`}
          sub={`Keeps bars ${first}–${first + punchBar - 1} from take ${previous?.number}`}
          checked={punch}
          onChange={(v) => !active && setPunch(v)}
          divided
          minHeight={56}
        />
      );

  const canKeep = !task.busy && !unsaved && ((mode === 'listening' && take.held >= 2) || (mode === 'idle' && !!parked));
  const listening = live && (
        <View style={[s.row, s.divided, { minHeight: 56 }]}>
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
      );

  const meter = live && (
        <View accessible={false} style={{ height: wide ? 8 : 4, borderRadius: wide ? 4 : 2, backgroundColor: C.line, overflow: 'hidden' }}>
          <View style={{ width: `${meterPct(active ? take.level : Math.max(input.levelL, input.levelR))}%`, height: wide ? 8 : 4, backgroundColor: take.clipped && active ? C.rec : C.text }} />
        </View>
      );

  const micRow = active ? (
        <Muted size={13}>
          Mic: {input.label}. Timing is corrected by {latencyMs} ms.
        </Muted>
      ) : (
        !live ? (
          <View style={[s.row, s.between, { minHeight: 56, borderTopWidth: 1, borderTopColor: C.line }, s.divided]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt size={15} w="semi">
                Microphone
              </Txt>
              <Txt size={13} color={input.error ? C.recText : C.muted}>
                {input.error ?? 'Not connected yet.'}
              </Txt>
            </View>
            <Chip label={input.status === 'opening' ? 'Connecting…' : 'Connect'} style={{ paddingHorizontal: 16, borderColor: C.text }} onPress={() => void openInput(settings.inputId, 'mic')} />
          </View>
        ) : (
          <View>
            <Disclosure
              title="Microphone and timing"
              summary={live ? `${input.label} · ${latencyMs} ms ${timing.measured ? 'measured' : 'estimated'}` : 'Not connected'}
              open={setup}
              onToggle={() => setSetup(!setup)}
              last
              size={15}
            >
              <MicSetup />
            </Disclosure>
            {live && !setup && <Muted size={13} style={{ paddingTop: 8 }}>Wear headphones so the beat stays out of the take.</Muted>}
          </View>
        )
      );

  // Shown right under the song header, where it cannot end up behind the bottom bar.
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

  // Hearing a take back needs one to exist.
  const canHear = !unsaved && (mode === 'recording' || project.takes.length > 0);
  const hear = () => (mode === 'recording' ? finish(() => router.push('/playback')) : (stopTake(false), router.push('/playback')));

  // Wide: the loop and the mic on the left, the bars to rap on the right, and hearing it back in the header. Recording is the mic in the rail.
  if (wide)
    return (
      <Screen gap={24}>
        <View style={[s.row, s.between, { gap: 32, minHeight: 64 }]}>
          <View style={{ flex: 1 }}>{header}</View>
          <View style={[s.row, { gap: 24 }]}>
            {mode === 'recording' && (
              <View style={[s.row, { gap: 12 }]}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.rec }} />
                <Txt size={44} w="display" lh={1} style={{ fontVariant: ['tabular-nums'] }}>
                  {clock(take.elapsed)}
                </Txt>
              </View>
            )}
            {canHear && (
              <Btn
                kind={mode === 'recording' ? 'primary' : 'outline'}
                size={18}
                label={mode === 'recording' ? 'Done, hear it back' : 'Hear it back'}
                disabled={task.busy}
                onPress={hear}
                style={{ flexGrow: 0, flexShrink: 0, flexBasis: 'auto', minHeight: 56, paddingHorizontal: 28, borderRadius: 18 }}
              />
            )}
          </View>
        </View>
        <Columns
          side={420}
          inner={14}
          left={
            <>
              {message}
              {empty}
              {loopCard}
              {punchIn}
              {listening}
              {meter}
              {micRow}
            </>
          }
          right={
            <View style={{ flex: 1, minHeight: 320, maxHeight: Math.max(320, height - 190), padding: 24, borderRadius: 24, borderWidth: 1, borderColor: C.border, gap: 16 }}>
              <View style={[s.row, s.between, { minHeight: 44 }]}>
                <Eyebrow>Your bars</Eyebrow>
                {/* Leaving for Song mid-take would drop the take, so the way there waits. */}
                {!active && (
                  <NavLink size={14} to="/song">
                    Edit on Song
                  </NavLink>
                )}
              </View>
              {project.lyrics.trim() ? (
                // The bars scroll inside their panel, so the loop stays in view beside them.
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                  <Txt size={22} lh={1.55}>
                    {project.lyrics}
                  </Txt>
                </ScrollView>
              ) : (
                <Muted size={15}>No bars written yet. Write them on the Song tab and they show here, big enough to read while you rap.</Muted>
              )}
            </View>
          }
        />
      </Screen>
    );

  return (
    <Screen gap={14}>
      {header}

      {message}

      {empty}

      {loopCard}

      {punchIn}

      {listening}

      {meter}
      {micRow}

      {/* Recording starts and stops from the mic in the bottom bar. Hearing a take back needs one to exist. */}
      {canHear && (
        <Foot center gap={14}>
          <Btn label={mode === 'recording' ? 'Done, hear it back' : 'Hear it back'} disabled={task.busy} onPress={hear} style={{ alignSelf: 'stretch' }} />
        </Foot>
      )}
    </Screen>
  );
}
