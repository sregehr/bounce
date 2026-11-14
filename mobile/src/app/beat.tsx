import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';

import { deleteProject, patchProject, useProject } from '@/data/store';
import { barsIn, loadPcm } from '@/data/studio';
import { play, seek, toggle } from '@/engine/engine';
import { Card, Chip, Eyebrow, Foot, Muted, NavLink, RoundPlay, Screen, SeekTrack, TopBar, Txt, s } from '@/ui/kit';
import { useArmed, useStopOnLeave, useTask, useTransport } from '@/ui/hooks';
import { Stat } from '@/ui/parts';
import { C, F, clock, db, lufs, rateLabel } from '@/ui/theme';

export default function BeatReady() {
  const project = useProject();
  const id = `beat:${project?.id}`;
  const t = useTransport(id);
  const task = useTask();
  const [armed, arm] = useArmed();
  const [tempoText, setTempoText] = useState<string | null>(null);
  useStopOnLeave();

  // Start decoding straight away so the play button answers at once.
  useEffect(() => {
    if (project) void loadPcm(project.beat.key).catch(() => {});
  }, [project?.beat.key]);

  if (!project) return <Redirect href="/" />;
  const beat = project.beat;

  const onPlay = () => {
    if (t.loaded) return toggle();
    void task.run(async () => play(id, { a: await loadPcm(beat.key) }));
  };
  const progress = t.duration > 0 ? t.position / t.duration : 0;
  const setBpm = (bpm: number | null) => patchProject(project.id, { beat: { ...beat, bpm: bpm && bpm >= 40 && bpm <= 240 ? Math.round(bpm * 100) / 100 : null } });
  const commitTempo = () => {
    if (tempoText === null) return;
    const typed = Number(tempoText.replace(',', '.'));
    if (tempoText.trim() === '') setBpm(null);
    else if (Number.isFinite(typed)) setBpm(typed);
    setTempoText(null);
  };
  const bars4 = barsIn(beat);

  return (
    <Screen gap={22} padBottom={32}>
      <TopBar left={<Eyebrow>{beat.source === 'capture' ? 'Beat captured' : beat.source === 'import' ? 'Beat imported' : 'Demo beat'}</Eyebrow>} right={beat.source === 'capture' ? <NavLink to="/capture" replace>Record again</NavLink> : undefined} />

      <View style={{ gap: 6 }}>
        <Txt size={12} color={C.muted}>
          Name
        </Txt>
        <TextInput
          accessibilityLabel="Name"
          value={project.name}
          onChangeText={(name) => patchProject(project.id, { name })}
          onBlur={() => !project.name.trim() && patchProject(project.id, { name: 'Untitled beat' })}
          selectionColor={C.accent}
          maxLength={60}
          style={{ fontFamily: F.display, fontSize: 30, letterSpacing: -0.6, color: C.text, borderBottomWidth: 1, borderBottomColor: C.border, paddingTop: 4, paddingBottom: 10 }}
        />
      </View>

      <Card style={{ paddingVertical: 18, paddingHorizontal: 16 }}>
        <View style={{ borderLeftWidth: 3, borderRightWidth: 3, borderColor: C.accent, borderRadius: 4, paddingHorizontal: 6 }}>
          <SeekTrack peaks={beat.wave} height={84} progress={t.loaded ? progress : 0} rest={C.text} disabled={!t.loaded || t.duration <= 0} onSeek={(f) => seek(f * t.duration)} label="Position in beat" />
        </View>
        <View style={[s.row, { gap: 14 }]}>
          <RoundPlay size={48} icon={18} playing={t.playing} onPress={onPlay} disabled={task.busy} />
          <View style={{ gap: 2, flex: 1 }}>
            <Txt size={15} w="medium">
              {[clock(t.loaded && t.position > 0 ? t.position : beat.durationSec), beat.bpm ? `${Math.round(beat.bpm)} BPM` : null, beat.musicalKey].filter(Boolean).join(' · ')}
            </Txt>
            <Txt size={13} color={C.muted}>
              {task.error ?? (beat.trimmedSec > 0.05 ? `Trimmed ${beat.trimmedSec.toFixed(1)} s of silence. ` : '') + `${rateLabel(beat.sampleRate)} · 24-bit`}
            </Txt>
          </View>
        </View>
      </Card>

      <View style={s.row}>
        <Stat label={beat.clipped ? 'Peak · clipped' : 'Peak'} value={db(beat.peakDb, 1)} alert={beat.clipped} />
        <Stat label="Loudness" value={lufs(beat.lufs, 0)} />
      </View>

      <View style={{ gap: 6 }}>
        <View style={[s.row, { gap: 8 }]}>
          <Txt size={14} style={{ width: 56 }}>
            Tempo
          </Txt>
          <TextInput
            accessibilityLabel="Tempo in beats per minute"
            value={tempoText ?? (beat.bpm ? String(Math.round(beat.bpm * 10) / 10) : '')}
            onChangeText={setTempoText}
            onBlur={commitTempo}
            onSubmitEditing={commitTempo}
            keyboardType="decimal-pad"
            placeholder="BPM"
            placeholderTextColor={C.muted}
            selectionColor={C.accent}
            style={[s.field, { minHeight: 44, width: 92, backgroundColor: C.bg }]}
          />
          <Chip label="Half" onPress={() => beat.bpm && setBpm(beat.bpm / 2)} style={{ paddingHorizontal: 12 }} />
          <Chip label="Double" onPress={() => beat.bpm && setBpm(beat.bpm * 2)} style={{ paddingHorizontal: 12 }} />
        </View>
        <Muted size={13}>
          {beat.bpm ? `${bars4} ${bars4 === 1 ? 'bar' : 'bars'} at this tempo. If the loop drifts, the tempo is off: fix it here.` : 'No steady tempo was found. Enter it to loop sections; without it the whole beat plays through.'}
        </Muted>
      </View>

      {beat.clipped && <Txt size={13} color={C.recText}>The input clipped while this was captured. Turn the source down and record again for a clean beat.</Txt>}

      <Foot gap={12}>
        <Txt size={20} w="display" ls={-0.01}>
          What next?
        </Txt>
        <Pressable accessibilityRole="button" onPress={() => router.push('/vocals')} style={({ pressed }) => ({ backgroundColor: C.accent, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 20, gap: 4, opacity: pressed ? 0.9 : 1 })}>
          <Txt size={19} w="display" ls={0} color={C.bg}>
            Freestyle over it
          </Txt>
          <Txt size={14} lh={1.4} color={C.bg}>
            Loop a section and rap. Polished playback in seconds.
          </Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            patchProject(project.id, { takeId: null }, false);
            router.push('/master');
          }}
          style={({ pressed }) => ({ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 20, gap: 4, opacity: pressed ? 0.9 : 1 })}
        >
          <Txt size={19} w="display" ls={0}>
            Master the beat
          </Txt>
          <Muted lh={1.4}>Instrumental only. Pick a style and export.</Muted>
        </Pressable>
        <NavLink
          center
          size={14}
          onPress={() => {
            if (!armed) return arm();
            void deleteProject(project.id).then(() => router.replace('/'));
          }}
        >
          {armed ? `Tap again to delete this beat${project.takes.length ? ' and its takes' : ''}` : 'Delete this beat'}
        </NavLink>
      </Foot>
    </Screen>
  );
}
