import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';

import type { Project } from '@/data/model';
import { deleteProject, patchProject } from '@/data/store';
import { barsIn } from '@/data/studio';

import { BeatPlayer } from './BeatPlayer';
import { useArmed } from './hooks';
import { Btn, Card, Chip, Eyebrow, Muted, NavLink, Txt, s } from './kit';
import { Stat } from './parts';
import { C, db, lufs, rateLabel } from './theme';

/**
 * The beat under a song, as one card on the Song screen. Closed, it names where the beat came
 * from, plays the beat while there is no take to play, and offers to master the beat alone.
 * Open, it adds everything else about the beat: its tempo and levels, and deleting it. Its name is the title
 * of the Song screen, and is changed there.
 */
export function BeatCard({ project, open, onToggle, note }: { project: Project; open: boolean; onToggle: () => void; note?: string }) {
  const beat = project.beat;
  const hasTake = project.takes.length > 0;
  return (
    <Card style={{ padding: 16, gap: 16 }}>
      <View style={[s.row, s.between]}>
        <Eyebrow>{beat.source === 'capture' ? 'Beat captured' : beat.source === 'import' ? 'Beat imported' : 'Demo beat'}</Eyebrow>
        <NavLink size={13} w="semi" style={{ minHeight: 24 }} onPress={onToggle}>
          {open ? 'Hide beat details' : 'Beat details ›'}
        </NavLink>
      </View>
      {/* With a take, the song's own player is the one in view, so the beat alone plays from the open card. */}
      {(open || !hasTake) && <BeatPlayer project={project} note={hasTake ? undefined : note} />}
      <View style={{ gap: 6 }}>
        <Btn
          kind="outline"
          label="Master the beat"
          onPress={() => {
            patchProject(project.id, { takeId: null }, false);
            router.push('/master');
          }}
        />
        <Muted size={13}>Instrumental only: pick a style and export it without a vocal.</Muted>
      </View>
      {open && <Details project={project} />}
    </Card>
  );
}

function Details({ project }: { project: Project }) {
  const beat = project.beat;
  const [armed, arm] = useArmed();
  const [tempoText, setTempoText] = useState<string | null>(null);

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
    <>
      <Txt size={13} color={C.muted}>
        {(beat.trimmedSec > 0.05 ? `Trimmed ${beat.trimmedSec.toFixed(1)} s of silence · ` : '') + `${rateLabel(beat.sampleRate)} · 24-bit`}
      </Txt>

      <View style={s.row}>
        <Stat label={beat.clipped ? 'Peak · clipped' : 'Peak'} value={db(beat.peakDb, 1)} alert={beat.clipped} />
        <Stat label="Loudness" value={lufs(beat.lufs, 0)} />
      </View>
      {beat.clipped && <Txt size={13} color={C.recText}>The input clipped while this was captured. Turn the source down and record again for a clean beat.</Txt>}

      <View style={{ gap: 6 }}>
        <View style={[s.row, { gap: 8 }]}>
          <Txt size={14} style={{ width: 52 }}>
            Tempo
          </Txt>
          <TextInput
            accessibilityLabel="Tempo in beats per minute"
            value={tempoText ?? (beat.bpm ? String(Math.round(beat.bpm * 10) / 10) : '')}
            onChangeText={setTempoText}
            onBlur={commitTempo}
            onSubmitEditing={commitTempo}
            keyboardType="decimal-pad"
            // The number pad has no return key of its own, so it gets a Done.
            returnKeyType="done"
            inputAccessoryViewButtonLabel="Done"
            placeholder="BPM"
            placeholderTextColor={C.muted}
            selectionColor={C.accent}
            style={[s.field, { minHeight: 44, width: 84, backgroundColor: C.bg }]}
          />
          <Chip label="Half" onPress={() => beat.bpm && setBpm(beat.bpm / 2)} style={{ paddingHorizontal: 12, opacity: beat.bpm ? 1 : 0.35 }} />
          <Chip label="Double" onPress={() => beat.bpm && setBpm(beat.bpm * 2)} style={{ paddingHorizontal: 12, opacity: beat.bpm ? 1 : 0.35 }} />
        </View>
        <Muted size={13}>
          {beat.bpm ? `${bars4} ${bars4 === 1 ? 'bar' : 'bars'} at this tempo. If the loop drifts, the tempo is off: fix it here.` : 'No steady tempo was found. Enter it to loop sections; without it the whole beat plays through.'}
        </Muted>
      </View>

      <View style={[s.row, s.between]}>
        {beat.source === 'capture' ? (
          <NavLink size={14} to="/capture">
            Record again
          </NavLink>
        ) : (
          <View />
        )}
        <NavLink
          size={14}
          onPress={() => {
            if (!armed) return arm();
            void deleteProject(project.id).then(() => router.replace('/'));
          }}
        >
          {armed ? `Tap again to delete this beat${project.takes.length ? ' and its takes' : ''}` : 'Delete this beat'}
        </NavLink>
      </View>
    </>
  );
}
