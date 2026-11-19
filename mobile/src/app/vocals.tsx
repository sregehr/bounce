import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';

import { sessionArtist } from '@/data/artists';
import { artistOf } from '@/data/songs';
import { activeTake, patchProject, setSettings, useLibrary, useProject } from '@/data/store';
import { fileBase } from '@/data/exporting';
import { saveFiles } from '@/data/files';
import { barSeconds, barsIn, getMix, loadPcm, loopSeconds, saveTake } from '@/data/studio';
import { encodeWav } from '@/dsp/wav';
import { engineState, inputAllowed, openInput, play, startTake, stopTake, stopTransport, useEngine, wake } from '@/engine/engine';
import type { RecordedTake } from '@/engine/types';
import { NoSong } from '@/ui/AddBeat';
import { ArtistView } from '@/ui/ArtistView';
import { setArtistViewOpen } from '@/ui/artistViewOpen';
import { Btn, Card, Chip, Disclosure, Eyebrow, Foot, Muted, NavLink, Option, Pulse, Screen, SeekTrack, Txt, s } from '@/ui/kit';
import { MicSetup } from '@/ui/MicSetup';
import { OnTheMic } from '@/ui/OnTheMic';
import { useTiming } from '@/ui/timing';
import { success, thump } from '@/ui/haptics';
import { useArmed, useOnScreen, useRecordingGuard, useTask, useTransport } from '@/ui/hooks';
import { askForMic, recordState, setRecordControl } from '@/ui/recordControl';
import { SongHeader } from '@/ui/SongHeader';
import { C, clock, meterPct, plural } from '@/ui/theme';
import { Columns, useWide } from '@/ui/wide';

/** A recording on its way into the song, with what is needed to store it. */
type Pending = { recorded: RecordedTake; origin: 'kept' | 'recorded'; punchAtSec?: number; layer?: boolean; note?: string };
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
  const finishing = useRef(false);
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
  // Which bars to record over is set on the Song tab. A picked take carries its own, and the song follows it.
  const pickedLoop = previous?.loop;
  useEffect(() => {
    if (project && pickedLoop && take.mode === 'idle' && (pickedLoop.bars !== project.loop.bars || pickedLoop.startBar !== project.loop.startBar)) patchProject(project.id, { loop: pickedLoop }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, pickedLoop?.bars, pickedLoop?.startBar, take.mode]);
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
    success();
    setSaved(`${pending.note ? `${pending.note} ` : ''}Take ${made.number} saved${pending.layer ? ' as a layer' : ''} · ${clock(made.durationSec)}${made.clipped ? ' · the mic clipped, back off a little' : ''}`);
    setPunch(false);
    // In the artist view a saved take stays on this screen: the mix is the owner's to open.
    if (!inBooth.current) then?.();
  };

  // `lost` is why the microphone went away, when that is what ended the take.
  const finish = async (then?: () => void, lost?: string) => {
    if (!project || finishing.current) return;
    // Stopped during the count-in: nothing has been recorded yet, so it is simply called off.
    if (counting) {
      stopTake(false);
      if (lost) task.setError(`${lost} Nothing had been recorded yet.`);
      return;
    }
    finishing.current = true;
    if (mode === 'recording') thump();
    const wasListening = mode !== 'recording';
    const recorded = mode === 'idle' ? parked : stopTake(true);
    setParked(null);
    await task.run(async () => {
      if (!recorded) throw new Error(lost ? `${lost} Nothing had been recorded yet.` : 'Nothing was recorded. Check the microphone level and try again.');
      if (recorded.peak < 0.003) throw new Error(lost ? `${lost} What was recorded up to then was silent, so it was not kept.` : 'That take was silent. Check that the right microphone is picked under Microphone and timing, then try again.');
      const layer = !wasListening && layering && canLayer;
      await store({ recorded, note: lost, origin: wasListening ? 'kept' : 'recorded', punchAtSec: !wasListening && !layer && punch && canPunch && bar ? punchBar * bar : undefined, layer }, layer ? () => router.push('/song') : then);
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

  // The mic in the bottom bar is the record button while this screen is open: with no
  // microphone yet it offers to connect one, and otherwise it starts and stops the take.
  // A take in progress comes first, so the button stops it even if the microphone has gone.
  const press = useRef(() => {});
  const control = recordState(live, mode);
  useEffect(() => {
    if (onScreen && project) setRecordControl({ state: control, busy: task.busy || !!unsaved, holding: !!unsaved, press: () => press.current() });
  }, [onScreen, !!project, control, task.busy, !!unsaved]);

  if (!project || project.saved) return <NoSong title="Nothing to record over yet" about="Add a beat, then come back here and rap over it." />;

  const begin = (next: 'listening' | 'recording') =>
    task.run(async () => {
      wake();
      if (next === 'recording') thump();
      setSaved(null);
      setParked(null);
      if (mode !== 'idle') stopTake(false);
      const stacking = next === 'recording' && layering && canLayer;
      // For a layer the picked take plays too, mixed as it is now, once through from its start.
      const beat = stacking ? await getMix(project) : await loadPcm(project.beat.key);
      await startTake(next, beat, loop && !stacking ? { start: loop.start, end: loop.end } : null, next === 'recording' && countIn ? { beats: 4, beatSec } : undefined);
    });

  press.current = () => {
    // A take that is still waiting to be saved comes first: recording again would replace it.
    if (task.busy || unsaved) return;
    if (mode === 'recording') return void finish();
    if (!live) return askForMic(true);
    void begin('recording');
  };

  if (booth) {
    /** Plays the take just made, mixed as the song is now, or stops it. */
    const hearLast = () =>
      hearing
        ? stopTransport()
        : task.run(async () => {
            wake();
            const mix = await getMix(project);
            await play(`booth:${project.id}`, { a: { channels: mix.channels, sampleRate: mix.sampleRate }, autoplay: true });
          });
    return (
      <ArtistView
        artist={who ?? artistOf(project, { artist: ownName })}
        song={project.name}
        lyrics={project.lyrics}
        live={live}
        micNote={input.error ?? 'Connect the microphone to record.'}
        onConnect={() => void openInput(settings.inputId, 'mic')}
        mode={mode}
        count={count}
        elapsed={take.elapsed}
        level={mode !== 'idle' ? take.level : Math.max(input.levelL, input.levelR)}
        clipped={take.clipped}
        busy={task.busy}
        note={task.error ?? (saved ? saved.split(' · ')[0] : null)}
        failed={!!task.error}
        takes={project.takes.length}
        hearing={hearing}
        onRecord={() => press.current()}
        onBeat={() => (mode === 'listening' ? void stopTake(false) : void begin('listening'))}
        onHear={hearLast}
        onExit={() => (stopTransport(), stopTake(false), setBooth(false))}
      />
    );
  }

  const active = mode !== 'idle';
  const within = active ? take.elapsed % span : 0;
  const cell = active && !counting ? Math.min(cells - 1, Math.floor((within / span) * cells)) : -1;
  const pass = Math.floor(take.elapsed / span) + 1;
  // The beat under the loop, for drawing: the slice of its waveform that the bars cover.
  const beatWave = project.beat.wave;
  const wave = loop && project.beat.durationSec > 0 ? beatWave.slice(Math.floor((loop.start / project.beat.durationSec) * beatWave.length), Math.max(1, Math.ceil((loop.end / project.beat.durationSec) * beatWave.length))) : beatWave;
  const first = (loop?.startBar ?? 0) + 1;

  const header = <SongHeader project={project} locked={active || !!unsaved} />;

  const onTheMic = <OnTheMic project={project} locked={active || !!unsaved} />;
  // Handing the phone over: the same screen, cut down to what the person at the mic needs.
  const artistView = !active && !unsaved && (
    <View style={[s.row, s.between, s.divided, { minHeight: 56 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size={15} w="semi">
          Artist view
        </Txt>
        <Txt size={13} color={C.muted}>
          Their bars and one big record button, for whoever is at the mic.
        </Txt>
      </View>
      <Chip label="Open artist view" style={{ paddingHorizontal: 16, borderColor: C.text }} onPress={() => (setSaved(null), task.setError(null), setBooth(true))} />
    </View>
  );

  // What is missing, and where to start it: the mic in the bar below is this screen's record button.
  const empty = !active && project.takes.length === 0 && (
        <View style={{ gap: 4 }}>
          <Txt size={17} w="semi">
            No takes yet
          </Txt>
          <Muted size={15}>Tap the mic below to record one over this beat, and it opens in the mix.</Muted>
        </View>
      );

  // Looping and listening both play the beat against the microphone, so they wait for one.
  const loopCard = live && (
        <Card style={wide ? { padding: 22, gap: 16, borderRadius: 24 } : { padding: 16, gap: 12 }}>
          <View style={[s.row, s.between]}>
            <Eyebrow>{loop ? `Loop · bars ${first}–${first + loop.bars - 1}` : 'Whole beat · once through'}</Eyebrow>
            {active ? (
              <Txt size={13} w="semi" color={mode === 'recording' ? C.recText : C.accent}>
                {counting ? `Count-in · ${count}` : loop ? `Bar ${first + cell} · pass ${pass}` : clock(take.elapsed)}
              </Txt>
            ) : (
              <NavLink size={13} w="semi" style={{ minHeight: 24 }} onPress={() => live && begin('listening')}>
                {loop ? 'Play the loop' : 'Play the beat'}
              </NavLink>
            )}
          </View>
          {/* The stretch of the beat being recorded over, drawn as it is on the Song and Mix tabs. */}
          <SeekTrack peaks={wave} height={wide ? 110 : 44} progress={active && !counting ? within / span : 0} played={mode === 'recording' ? C.rec : C.accent} disabled onSeek={() => {}} label={loop ? 'Place in the loop' : 'Place in the beat'} duration={span} />
          {!bar && <Muted size={13}>Set the tempo in the beat details on the Song tab to loop 8 or 16 bars. Until then the whole beat plays through.</Muted>}
          {project.loop.bars > total && bar && !active ? <Muted size={13}>This beat is {plural(total, 'bar')} long, so that is what loops.</Muted> : null}
        </Card>
      );

  const punchIn = canPunch && (
        <Option
          label={`Punch in at bar ${first + punchBar}`}
          sub={`Keeps bars ${first}–${first + punchBar - 1} from take ${previous?.number}`}
          checked={punch}
          onChange={(v) => !active && (setPunch(v), v && setLayering(false))}
          divided
          minHeight={56}
        />
      );

  const layerOption = live && canLayer && (
        <Option
          label={`Record as a layer on take ${previous?.number}`}
          sub="That take plays along. The new one is stacked on it, for doubles and ad-libs."
          checked={layering}
          onChange={(v) => !active && (setLayering(v), v && setPunch(false))}
          divided
          minHeight={56}
        />
      );

  const countInOption = live && (
        <Option label="Count-in" sub={bar ? 'One bar of clicks before recording starts' : 'Four clicks before recording starts'} checked={countIn} onChange={(v) => !active && setSettings({ countIn: v })} divided minHeight={56} />
      );

  // On a phone the bars sit right under the loop, so they can be read while rapping.
  const lyrics = project.lyrics.trim() ? (
        <Card style={{ padding: 16, gap: 8 }}>
          <Eyebrow>Your bars</Eyebrow>
          <ScrollView nestedScrollEnabled style={{ maxHeight: Math.max(160, Math.min(300, height * 0.3)) }} showsVerticalScrollIndicator={false}>
            <Txt size={18} lh={1.5}>
              {project.lyrics}
            </Txt>
          </ScrollView>
        </Card>
      ) : (
        !active && !unsaved && (
          <NavLink size={13} to="/song" style={{ minHeight: 28 }}>
            Write your bars on Song to read them here
          </NavLink>
        )
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
            {input.muted ? (
              <Txt size={13} color={C.recText} style={{ paddingTop: 8 }}>
                The microphone is muted, so a take would be silent. Unmute it, or end the call that is using it.
              </Txt>
            ) : (
              live && !setup && <Muted size={13} style={{ paddingTop: 8 }}>Wear headphones so the beat stays out of the take.</Muted>
            )}
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

  // Wide: the loop and the mic on the left, the bars to rap on the right, and hearing it back in the header. Recording is the mic in the bar below.
  if (wide)
    return (
      <Screen gap={24}>
        <View style={[s.row, s.between, { gap: 32, minHeight: 64 }]}>
          <View style={{ flex: 1 }}>{header}</View>
          <View style={[s.row, { gap: 24 }]}>
            {mode === 'recording' && (
              <View style={[s.row, { gap: 12 }]}>
                <Pulse size={12} color={C.rec} on={!counting} />
                <Txt size={44} w="display" lh={1} style={{ fontVariant: ['tabular-nums'] }}>
                  {counting ? count : clock(take.elapsed)}
                </Txt>
              </View>
            )}
            {canHear && (
              <Btn
                kind={mode === 'recording' ? 'primary' : 'outline'}
                size={18}
                label={counting ? 'Cancel' : mode === 'recording' ? 'Done, hear it back' : 'Hear it back'}
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
              {onTheMic}
              {artistView}
              {loopCard}
              {punchIn}
              {layerOption}
              {countInOption}
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
                {!active && !unsaved && (
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

      {onTheMic}

      {artistView}

      {loopCard}

      {lyrics}

      {punchIn}

      {layerOption}

      {countInOption}

      {listening}

      {meter}
      {micRow}

      {/* Recording starts and stops from the mic in the bottom bar. Hearing a take back needs one to exist. */}
      {canHear && (
        <Foot center gap={14}>
          <Btn label={counting ? 'Cancel' : mode === 'recording' ? 'Done, hear it back' : 'Hear it back'} disabled={task.busy} onPress={hear} style={{ alignSelf: 'stretch' }} />
        </Foot>
      )}
    </Screen>
  );
}
