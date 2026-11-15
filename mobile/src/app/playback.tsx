import { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { activeTake, deleteTake, patchProject, useLibrary, useProject } from '@/data/store';
import { fileBase } from '@/data/exporting';
import { saveFiles } from '@/data/files';
import { useSong } from '@/data/song';
import { getMix, loadPcm } from '@/data/studio';
import { encodeWav } from '@/dsp/wav';
import { VOCAL_STYLES, type Polish } from '@/dsp/presets';
import { Btn, Chips, NavLink, Option, Screen, SliderRow, Txt } from '@/ui/kit';
import { useArmed, useStopOnLeave, useTask } from '@/ui/hooks';
import { ChainEditor } from '@/ui/ChainEditor';
import { Status } from '@/ui/parts';
import { Transport, useRepeat } from '@/ui/Transport';
import { TAB_BAR_HEIGHT } from '@/ui/tabs';
import { C, clock } from '@/ui/theme';

// Height of the pinned last step, above the floating bar.
const FINISH_HEIGHT = 62;

export default function Playback() {
  const project = useProject();
  const take = activeTake(project);
  // The mix keeps coming round while it is being shaped, unless Repeat is turned off.
  const repeat = useRepeat();
  const song = useSong(take ? project : null, { compare: true, repeat });
  const insets = useSafeAreaInsets();
  const [level, setLevel] = useState<number | null>(null);
  const [armed, arm] = useArmed();
  const stems = useTask();
  // How many finished songs in the Vault were made from this beat.
  const vaulted = useLibrary((l) => l.projects).filter((p) => p.saved?.from === project?.id).length;
  const [sent, setSent] = useState<string | null>(null);
  useStopOnLeave();

  if (!project) return <Redirect href="/" />;
  if (!take) return <Redirect href="/vocals" />;

  const { mix } = song;
  const polish = project.polish;
  const setPolish = (patch: Partial<Polish>) => patchProject(project.id, { polish: { ...polish, ...patch } });
  const state = song.error ? 'Could not render' : song.busy ? (mix ? 'Updating…' : 'Polishing…') : 'Polished';
  /** The untouched parts an engineer would want: the beat, the raw vocal, and the processed vocal. */
  const sendStems = () =>
    stems.run(async () => {
      const base = fileBase(`${project.name} take ${take.number}`);
      const beat = await loadPcm(project.beat.key);
      const raw = await loadPcm(take.key);
      const vocals = await getMix(project, { include: 'vocals' });
      await saveFiles(
        [
          { name: `${base} - beat.wav`, data: encodeWav(beat.channels, beat.sampleRate, 24), type: 'audio/wav' },
          { name: `${base} - vocal raw.wav`, data: encodeWav(raw.channels, raw.sampleRate, 24), type: 'audio/wav' },
          { name: `${base} - vocal processed.wav`, data: encodeWav(vocals.channels, vocals.sampleRate, 24), type: 'audio/wav' },
        ],
        `${base} stems`,
      );
      setSent(`Saved ${base} stems.zip to your downloads: the beat, the raw vocal and the processed vocal.`);
    });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen gap={18}>
        <View style={{ gap: 12 }}>
          <Txt size={30} w="display" ls={-0.03} lh={1.05} numberOfLines={2}>
            {project.name}
          </Txt>
          {/* Where the song stands, at a glance. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Status label={`Take ${take.number} · ${clock(take.durationSec)}`} />
            <Status label={state} tone={song.error ? 'bad' : song.busy ? 'plain' : 'good'} />
            <Status label={vaulted === 0 ? 'Not in the Vault yet' : vaulted === 1 ? 'In the Vault' : `${vaulted} in the Vault`} tone={vaulted ? 'good' : 'todo'} />
          </View>
          {song.error && (
            <Txt size={13} color={C.recText}>
              {song.error}
            </Txt>
          )}
        </View>

        <View style={{ gap: 12 }}>
          <Transport project={project} take={take} song={song} compare />
          <Chips options={VOCAL_STYLES} value={polish.style} onChange={(style) => patchProject(project.id, (p) => ({ polish: { ...p.polish, style }, overrides: { ...p.overrides, vocal: undefined }, space: p.space && { ...p.space, vocal: { ...p.space.vocal, reverb: undefined } } }))} />
        </View>

        {/* The mix controls are always on show; the deeper chain editing is one tap further. */}
        <View>
          <View>
            <Option label="Double track, nudged and panned" w="regular" checked={polish.double} onChange={(double) => setPolish({ double })} minHeight={46} />
            <SliderRow label="Vocal level" value={level ?? polish.vocalLevel} onChange={setLevel} onCommit={(v) => (setLevel(null), setPolish({ vocalLevel: v }))} labelWidth={92} minHeight={44} fontSize={15} display={`${level ?? polish.vocalLevel}`} valueWidth={30} />
            <View style={{ paddingTop: 10, paddingBottom: 6 }}>
              <ChainEditor project={project} song={song} />
            </View>
            <NavLink size={14} to="/export">
              Export without saving
            </NavLink>
            <NavLink size={14} onPress={() => !stems.busy && sendStems()}>
              {stems.busy ? 'Gathering the stems…' : 'Send stems to an engineer'}
            </NavLink>
            {(stems.error || sent) && (
              <Txt size={13} color={stems.error ? C.recText : C.muted}>
                {stems.error ?? sent}
              </Txt>
            )}
            <NavLink
              size={14}
              onPress={() => {
                if (!armed) return arm();
                void deleteTake(project.id, take.id);
              }}
            >
              {armed ? `Tap again to delete take ${take.number}` : 'Delete this take'}
            </NavLink>
          </View>
        </View>

        {/* Room for the pinned step below. */}
        <View style={{ height: FINISH_HEIGHT }} />
      </Screen>

      {/* The last step stays in reach however far the page is scrolled. Its strip runs down behind the floating bar. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: TAB_BAR_HEIGHT + insets.bottom, paddingHorizontal: 24, paddingTop: 10, backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.border }}>
        <Btn label="Finish song" to="/cover?finish=1" style={{ flex: 0, minHeight: 52 }} />
      </View>
    </View>
  );
}
