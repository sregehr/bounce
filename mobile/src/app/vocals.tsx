import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { tempoLine } from '@/data/labels';
import type { LoopChoice } from '@/data/model';
import { activeTake, patchProject, useLibrary, useProject } from '@/data/store';
import { barSeconds, barsIn, loadPcm, loopSeconds, saveTake } from '@/data/studio';
import { engineState, inputAllowed, openInput, startTake, stopTake, useEngine, wake } from '@/engine/engine';
import { NoSong } from '@/ui/AddBeat';
import { Btn, Card, Chip, Disclosure, Eyebrow, Foot, Muted, NavLink, Option, Screen, Segmented, Txt, s } from '@/ui/kit';
import { MicSetup } from '@/ui/MicSetup';
import { useTiming } from '@/ui/timing';
import { useOnScreen, useTask } from '@/ui/hooks';
import { askForMic, setRecordControl } from '@/ui/recordControl';
import { C, clock, meterPct, plural } from '@/ui/theme';

const LENGTHS = ['8 bars', '16 bars', 'Whole beat'] as const;
type Length = (typeof LENGTHS)[number];
const toBars = (l: Length): LoopChoice['bars'] => (l === '8 bars' ? 8 : l === '16 bars' ? 16 : 0);
const toLength = (b: LoopChoice['bars']): Length => (b === 8 ? '8 bars' : b === 16 ? '16 bars' : 'Whole beat');

export default function Vocals() {
  const project = useProject();
  const settings = useLibrary((l) => l.settings);
  const input = useEngine((e) => e.input);
  const take = useEngine((e) => e.take);
  const task = useTask();
  const [punch, setPunch] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const finishing = useRef(false);
  const [onScreen, setOnScreen] = useState(false);
  const live = input.status === 'ready';
  const mode = take.mode;

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

  const finish = async (then?: () => void) => {
    if (!project || finishing.current) return;
    finishing.current = true;
    const wasListening = mode === 'listening';
    const recorded = stopTake(true);
    await task.run(async () => {
      if (!recorded) throw new Error('Nothing was recorded. Check the microphone level and try again.');
      if (recorded.peak < 0.003) throw new Error('That take was silent. Check that the right microphone is picked under Microphone and timing, then try again.');
      const made = await saveTake(project.id, recorded, { latencyMs, origin: wasListening ? 'kept' : 'recorded', punchAtSec: !wasListening && punch && canPunch && bar ? punchBar * bar : undefined });
      if (!made) throw new Error('That take was too short to keep.');
      setSaved(`Take ${made.number} saved · ${clock(made.durationSec)}${made.clipped ? ' · the mic clipped, back off a little' : ''}`);
      setPunch(false);
      then?.();
    });
    finishing.current = false;
  };

  // A beat that plays through once ends the take by itself.
  useEffect(() => {
    if (take.ended && mode !== 'idle') void finish(mode === 'recording' ? () => router.push('/playback') : undefined);
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
      if (mode !== 'idle') stopTake(false);
      const beat = await loadPcm(project.beat.key);
      await startTake(next, beat, loop ? { start: loop.start, end: loop.end } : null);
    });

  press.current = () => {
    if (task.busy) return;
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

  return (
    <Screen gap={14}>
      <View style={[s.topbar, { minHeight: 48 }]}>
        <Pressable accessibilityRole="link" accessibilityLabel={`${project.name}: beat details`} onPress={() => !active && router.push('/beat')} style={{ gap: 2, flexShrink: 1 }}>
          <Txt size={24} w="display" numberOfLines={1}>
            {project.name}
          </Txt>
          <Txt size={13} color={C.muted}>
            {tempoLine(project) || 'Tempo not set'}
          </Txt>
        </Pressable>
      </View>

      {!active && project.takes.length === 0 && (
        <View accessibilityRole="alert" style={{ borderWidth: 1, borderColor: C.accent, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 2 }}>
          <Txt size={15} w="semi" color={C.accent}>
            No takes yet
          </Txt>
          <Txt size={14} lh={1.4} color={C.muted}>
            Record one over this beat and it opens in the mix.
          </Txt>
          <NavLink size={14} w="semi" onPress={() => press.current()}>
            Record a take
          </NavLink>
        </View>
      )}

      {/* Looping and listening both play the beat against the microphone, so they wait for one. */}
      {live && (
        <Card style={{ padding: 16, gap: 12 }}>
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
          <View accessible={false} style={{ flexDirection: 'row', gap: 3 }}>
            {Array.from({ length: cells }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 34, borderRadius: 4, backgroundColor: !active ? C.dim : i < cell ? C.text : i === cell ? (mode === 'recording' ? C.rec : C.accent) : C.dim }} />
            ))}
          </View>
          {bar ? (
            <Segmented options={LENGTHS} value={length} onChange={(l) => setLoop({ bars: toBars(l) })} variant="inset" />
          ) : (
            <Muted size={13}>Set the tempo on the beat screen to loop 8 or 16 bars. Until then the whole beat plays through.</Muted>
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
      )}

      {canPunch && (
        <Option
          label={`Punch in at bar ${first + punchBar}`}
          sub={`Keeps bars ${first}–${first + punchBar - 1} from take ${previous?.number}`}
          checked={punch}
          onChange={(v) => !active && setPunch(v)}
          divided
          minHeight={56}
        />
      )}

      {live && (
        <View style={[s.row, s.divided, { minHeight: 56 }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size={15} w="semi">
              Always listening
            </Txt>
            <Txt size={13} color={C.muted}>
              {mode === 'listening' ? `Holding the last ${clock(take.held)}. Missed the start?` : `Play the ${loop ? 'loop' : 'beat'} and rap. The last 60 s are held.`}
            </Txt>
          </View>
          <Chip label="Keep that" style={{ paddingHorizontal: 16, borderColor: C.text, opacity: mode === 'listening' && take.held >= 2 ? 1 : 0.35 }} onPress={() => mode === 'listening' && take.held >= 2 && finish(() => router.push('/playback'))} />
        </View>
      )}

      {live && (
        <View accessible={false} style={{ height: 4, borderRadius: 2, backgroundColor: C.line, overflow: 'hidden' }}>
          <View style={{ width: `${meterPct(active ? take.level : Math.max(input.levelL, input.levelR))}%`, height: 4, backgroundColor: take.clipped && active ? C.rec : C.text }} />
        </View>
      )}
      {active ? (
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
      )}

      {(task.error || saved) && (
        <Txt size={14} w="medium" color={task.error ? C.recText : C.accent} center>
          {task.error ?? saved}
        </Txt>
      )}

      {/* Recording starts and stops from the mic in the bottom bar. Hearing a take back needs one to exist. */}
      {(mode === 'recording' || project.takes.length > 0) && (
        <Foot center gap={14}>
          <Btn
            label={mode === 'recording' ? 'Done, hear it back' : 'Hear it back'}
            disabled={task.busy}
            onPress={() => (mode === 'recording' ? finish(() => router.push('/playback')) : (stopTake(false), router.push('/playback')))}
            style={{ alignSelf: 'stretch' }}
          />
        </Foot>
      )}
    </Screen>
  );
}
