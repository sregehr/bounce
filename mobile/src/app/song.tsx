import { Pressable, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tempoLine } from '@/data/labels';
import type { Take } from '@/data/model';
import { activeTake, patchProject, useLibrary, useProject } from '@/data/store';
import { useSong } from '@/data/song';
import { Btn, Eyebrow, Muted, RoundPlay, Screen, SeekTrack, Txt, s } from '@/ui/kit';
import { useStopOnLeave } from '@/ui/hooks';
import { Status } from '@/ui/parts';
import { TAB_BAR_HEIGHT } from '@/ui/tabs';
import { C, F, clock, dayLabel, plural } from '@/ui/theme';

// Height of the pinned next step, without the gap that keeps it clear of the mic button.
const NEXT_HEIGHT = 72;

/** The song being worked on: its beat, every take recorded over it, and its lyrics. Picking a take here is what Mix then shapes. */
export default function Song() {
  const project = useProject();
  const take = activeTake(project);
  const song = useSong(take ? project : null, { autoplay: false });
  const vaulted = useLibrary((l) => l.projects).filter((p) => p.saved?.from === project?.id).length;
  const insets = useSafeAreaInsets();
  useStopOnLeave();

  if (!project || project.saved) return <Redirect href="/" />;

  const { t, mix } = song;
  const progress = t.duration > 0 ? t.position / t.duration : 0;
  const about = (k: Take) => [dayLabel(k.createdAt), clock(k.durationSec), k.origin === 'kept' ? 'kept' : k.origin === 'punched' ? 'punched in' : null].filter(Boolean).join(' · ');
  /** Tapping a take picks it and plays it polished over the beat; tapping the picked one plays or pauses. */
  const pick = (k: Take) => {
    if (k.id === take?.id) return song.toggle();
    song.playWhenReady();
    patchProject(project.id, { takeId: k.id }, false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen gap={20}>
        <View style={{ gap: 12 }}>
          <Pressable accessibilityRole="link" accessibilityLabel={`${project.name}: beat details`} onPress={() => router.push('/beat')} style={{ gap: 4 }}>
            <Txt size={30} w="display" ls={-0.03} lh={1.05} numberOfLines={2}>
              {project.name}
            </Txt>
            <Txt size={13} color={C.muted}>
              {[tempoLine(project) || 'Tempo not set', clock(project.beat.durationSec), 'beat details ›'].join(' · ')}
            </Txt>
          </Pressable>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Status label={project.takes.length ? plural(project.takes.length, 'take') : 'No takes yet'} tone={project.takes.length ? 'plain' : 'todo'} />
            {project.lyrics.trim() ? <Status label="Has lyrics" /> : null}
            <Status label={vaulted === 0 ? 'Not in the Vault yet' : vaulted === 1 ? 'In the Vault' : `${vaulted} in the Vault`} tone={vaulted ? 'good' : 'todo'} />
          </View>
        </View>

        {take ? (
          <View>
            <View style={[s.row, { gap: 12, paddingBottom: 6 }]}>
              <RoundPlay playing={t.playing} onPress={song.toggle} disabled={!mix} />
              <SeekTrack peaks={take.wave} height={44} progress={progress} disabled={!t.loaded || t.duration <= 0} onSeek={(f) => song.seek(f * t.duration)} label="Position in take" style={{ flex: 1 }} />
            </View>
            <Txt size={13} color={song.error ? C.recText : C.muted} style={{ paddingBottom: 6 }}>
              {song.error ?? (song.busy ? `Polishing take ${take.number}…` : `Take ${take.number}, polished over the beat`)}
            </Txt>
            {[...project.takes].reverse().map((k) => {
              const on = k.id === take.id;
              return (
                <Pressable key={k.id} accessibilityRole="radio" accessibilityLabel={`Take ${k.number}`} accessibilityState={{ checked: on }} onPress={() => pick(k)} style={[s.row, s.between, { minHeight: 48 }, s.divided]}>
                  <Txt size={15} w="semi" color={on ? C.accent : C.text}>
                    Take {k.number}
                  </Txt>
                  <Txt size={13} color={on ? C.accent : C.muted}>
                    {on ? `${about(k)} · picked` : about(k)}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Muted>Nothing recorded over this beat yet. Tap the mic below to record a take, and it shows up here.</Muted>
        )}

        <View style={{ gap: 8 }}>
          <Eyebrow>Lyrics</Eyebrow>
          <TextInput
            accessibilityLabel="Lyrics"
            multiline
            value={project.lyrics}
            onChangeText={(text) => patchProject(project.id, { lyrics: text })}
            placeholder="Write the bars here. They stay with the song when you finish it, and the first line can caption a snippet."
            placeholderTextColor={C.muted}
            selectionColor={C.accent}
            style={{ minHeight: 120, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, color: C.text, fontFamily: F.regular, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' }}
          />
        </View>

        {take && <View style={{ height: NEXT_HEIGHT }} />}
      </Screen>

      {/* The next step stays in reach however far the page is scrolled. It ends clear of the raised mic button. */}
      {take && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: TAB_BAR_HEIGHT + insets.bottom, height: NEXT_HEIGHT + 22, paddingHorizontal: 24, paddingTop: 10, backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.border }}>
          <Btn label={`Mix take ${take.number}`} to="/playback" style={{ flex: 0, minHeight: 52 }} />
        </View>
      )}
    </View>
  );
}
