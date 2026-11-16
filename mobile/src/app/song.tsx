import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Take } from '@/data/model';
import { activeTake, deleteTake, patchProject, useLibrary, useProject } from '@/data/store';
import { useSong } from '@/data/song';
import { NoSong } from '@/ui/AddBeat';
import { BeatCard } from '@/ui/BeatDetails';
import { Btn, Eyebrow, Muted, Screen, Txt, s } from '@/ui/kit';
import { useStopOnLeave } from '@/ui/hooks';
import { Status, SwipeRow } from '@/ui/parts';
import { SongHeader } from '@/ui/SongHeader';
import { TAB_BAR_HEIGHT } from '@/ui/tabs';
import { Transport, useRepeat } from '@/ui/Transport';
import { C, F, clock, dayLabel, plural } from '@/ui/theme';

// Height of the pinned next step, above the floating bar.
const NEXT_HEIGHT = 62;

/** The song being worked on: its beat, every take recorded over it, and its lyrics. Picking a take here is what Mix then shapes. */
export default function Song() {
  const project = useProject();
  const take = activeTake(project);
  const repeat = useRepeat();
  const song = useSong(take ? project : null, { autoplay: false, repeat });
  const vaulted = useLibrary((l) => l.projects).filter((p) => p.saved?.from === project?.id).length;
  const insets = useSafeAreaInsets();
  const [details, setDetails] = useState(false);
  useStopOnLeave();

  // Mastering the beat alone sets the take aside. Back here, the song has its newest take again.
  const newest = project && !project.saved && !take ? project.takes[project.takes.length - 1] : undefined;
  useEffect(() => {
    if (project && newest) patchProject(project.id, { takeId: newest.id }, false);
  }, [project?.id, newest?.id]);

  if (!project || project.saved) return <NoSong title="No song yet" about="A song starts with a beat. Add one and its takes and lyrics live here." />;

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
        <SongHeader project={project}>
          <Status label={project.takes.length ? plural(project.takes.length, 'take') : 'No takes yet'} tone={project.takes.length ? 'plain' : 'todo'} />
          {project.lyrics.trim() ? <Status label="Has lyrics" /> : null}
          <Status label={vaulted === 0 ? 'Not in the Vault yet' : vaulted === 1 ? 'In the Vault' : `${vaulted} in the Vault`} tone={vaulted ? 'good' : 'todo'} />
        </SongHeader>

        {take ? (
          <View>
            <Transport project={project} take={take} song={song} />
            <Txt size={13} color={song.error ? C.recText : C.muted} style={{ paddingTop: 8, paddingBottom: 6 }}>
              {song.error ?? (song.busy ? `Polishing take ${take.number}…` : `Take ${take.number}, polished over the beat`)}
            </Txt>
            {[...project.takes].reverse().map((k) => {
              const on = k.id === take.id;
              return (
                <SwipeRow key={k.id} label={`Delete take ${k.number}`} onDelete={() => void deleteTake(project.id, k.id)}>
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
        )}

        {/* Until there is a take, the beat is the thing to play, so its card comes first. After that the lyrics do. */}
        {!take && (
          <BeatCard project={project} open={details} onToggle={() => setDetails(!details)} note="The beat by itself" />
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

        {take && (
          <BeatCard project={project} open={details} onToggle={() => setDetails(!details)} note="The beat by itself" />
        )}

        {take && <View style={{ height: NEXT_HEIGHT }} />}
      </Screen>

      {/* The next step stays in reach however far the page is scrolled. Its strip runs down behind the floating bar. */}
      {take && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: TAB_BAR_HEIGHT + insets.bottom, paddingHorizontal: 24, paddingTop: 10, backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.border }}>
          <Btn label={`Mix take ${take.number}`} to="/playback" style={{ flex: 0, minHeight: 52 }} />
        </View>
      )}
    </View>
  );
}
