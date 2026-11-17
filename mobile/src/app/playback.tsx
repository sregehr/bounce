import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { activeTake, deleteTake, patchProject, useLibrary, useProject, redoMix, switchMix, undoMix, useMixHistory } from '@/data/store';
import { fileBase } from '@/data/exporting';
import { saveFiles } from '@/data/files';
import { useSong } from '@/data/song';
import { getMix, loadPcm } from '@/data/studio';
import { encodeWav } from '@/dsp/wav';
import { VOCAL_STYLES, type Polish } from '@/dsp/presets';
import { NoSong } from '@/ui/AddBeat';
import { Btn, Chip, Chips, Muted, NavLink, Option, Screen, Segmented, SliderRow, Txt, s } from '@/ui/kit';
import { useArmed, useStopOnLeave, useTask } from '@/ui/hooks';
import { ChainEditor } from '@/ui/ChainEditor';
import { Status, UndoToast } from '@/ui/parts';
import { SongHeader } from '@/ui/SongHeader';
import { Transport, useRepeat } from '@/ui/Transport';
import { C, clock } from '@/ui/theme';
import { useBar, useGutter, useWide } from '@/ui/wide';

// Height of the pinned last step, above the floating bar.
const FINISH_HEIGHT = 62;
// Width of the left pane in the wide layout: the transport and the broad strokes.
const LISTEN_WIDTH = 400;

const MIX_SIDES = ['Mix A', 'Mix B'] as const;

export default function Playback() {
  const project = useProject();
  const take = activeTake(project);
  // The mix keeps coming round while it is being shaped, unless Repeat is turned off.
  const repeat = useRepeat();
  const song = useSong(take ? project : null, { compare: true, repeat });
  const insets = useSafeAreaInsets();
  const gutter = useGutter();
  const bar = useBar();
  const [level, setLevel] = useState<number | null>(null);
  const [armed, arm] = useArmed();
  const stems = useTask();
  // How many finished songs in the Vault were made from this beat.
  const vaulted = useLibrary((l) => l.projects).filter((p) => p.saved?.from === project?.id).length;
  const [sent, setSent] = useState<string | null>(null);
  const history = useMixHistory(project?.id ?? null);
  const projectId = project?.id;
  // On a keyboard, the usual keys undo and redo a change to the mix.
  useEffect(() => {
    if (Platform.OS !== 'web' || !projectId) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || (e.target as HTMLElement | null)?.closest?.('input,textarea')) return;
      e.preventDefault();
      if (e.shiftKey) redoMix(projectId);
      else undoMix(projectId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projectId]);
  const wide = useWide();
  useStopOnLeave();

  if (!project || project.saved) return <NoSong title="Nothing to mix yet" about="Add a beat and record a take over it, and the mix opens here." />;
  // A beat with nothing recorded over it: Mix says so, and leads to the mic.
  if (!take)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen gap={20}>
        <SongHeader project={project} />
        <View style={{ gap: 4 }}>
          <Txt size={17} w="semi">
            Nothing to mix yet
          </Txt>
          <Muted size={15}>Record a take over this beat and its mix opens here.</Muted>
        </View>
        <Btn label="Record a take" to="/vocals" />
      </Screen>
      {/* The take that was just deleted here can still be brought back. */}
      <UndoToast projectId={project.id} />
      </View>
    );

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

  const header = (
        <View style={{ gap: 12 }}>
          {/* Where the song stands, at a glance. */}
          <SongHeader project={project}>
            <Status label={`Take ${take.number} · ${clock(take.durationSec)}`} />
            <Status label={state} tone={song.error ? 'bad' : song.busy ? 'plain' : 'good'} />
            <Status label={vaulted === 0 ? 'Not in the Vault yet' : vaulted === 1 ? 'In the Vault' : `${vaulted} in the Vault`} tone={vaulted ? 'good' : 'todo'} />
          </SongHeader>
          {song.error && (
            <Txt size={13} color={C.recText}>
              {song.error}
            </Txt>
          )}
        </View>
  );

  const listen = (
        <View style={{ gap: 12 }}>
          <Transport project={project} take={take} song={song} compare />
          <Chips options={VOCAL_STYLES} value={polish.style} onChange={(style) => patchProject(project.id, (p) => ({ polish: { ...p.polish, style }, overrides: { ...p.overrides, vocal: undefined }, space: p.space && { ...p.space, vocal: { ...p.space.vocal, reverb: undefined } } }))} />
        </View>
  );

  const double = <Option label="Double track, nudged and panned" w="regular" checked={polish.double} onChange={(double) => setPolish({ double })} minHeight={46} />;
  const vocalLevel = <SliderRow label="Vocal level" value={level ?? polish.vocalLevel} onChange={setLevel} onCommit={(v) => (setLevel(null), setPolish({ vocalLevel: v }))} labelWidth={92} minHeight={44} fontSize={15} display={`${level ?? polish.vocalLevel}`} valueWidth={30} />;
  const chains = <ChainEditor project={project} song={song} />;

  const links = (
    <>
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
                deleteTake(project.id, take.id);
              }}
            >
              {armed ? `Tap again to delete take ${take.number}` : 'Delete this take'}
            </NavLink>
    </>
  );

  // Stepping back through changes, and two mixes to flip between while it plays.
  const side = project.mixSide ?? 'A';
  const compare = (
    <View style={[s.row, s.between, { gap: 12, minHeight: 44 }]}>
      <View style={[s.row, { gap: 8 }]}>
        <Chip label="Undo" onPress={() => history.canUndo && undoMix(project.id)} style={{ paddingHorizontal: 14, opacity: history.canUndo ? 1 : 0.35 }} />
        <Chip label="Redo" onPress={() => history.canRedo && redoMix(project.id)} style={{ paddingHorizontal: 14, opacity: history.canRedo ? 1 : 0.35 }} />
      </View>
      <View style={{ width: 168 }}>
        <Segmented options={MIX_SIDES} value={side === 'A' ? 'Mix A' : 'Mix B'} onChange={(v) => switchMix(project.id, v === 'Mix A' ? 'A' : 'B')} variant="compact" />
      </View>
    </View>
  );

  // Wide: listening and the broad strokes on the left, the chains open on the right, and the last step in the header.
  if (wide)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen gap={22}>
        <View style={[s.row, s.between, { alignItems: 'flex-start', gap: 32 }]}>
          <View style={{ flex: 1 }}>{header}</View>
          <Btn label="Finish song" to="/cover?finish=1" style={{ flexGrow: 0, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: 32 }} />
        </View>
        {/* Columns fixes its right pane; here the narrow one is on the left. */}
        <View style={{ flex: 1, flexDirection: 'row', gap: 36, minHeight: 0 }}>
          <View style={{ width: LISTEN_WIDTH, gap: 12 }}>
            {listen}
            <View>
              {compare}
              {double}
              {vocalLevel}
            </View>
            {/* The rarely used links sit at the foot of the pane, out of the way. */}
            <View style={{ flexGrow: 1, justifyContent: 'flex-end' }}>{links}</View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>{chains}</View>
        </View>
      </Screen>
      <UndoToast projectId={project.id} />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen gap={18}>
        {header}

        {listen}

        {/* The mix controls are always on show; the deeper chain editing is one tap further. */}
        <View>
          <View>
            {compare}
            {double}
            {vocalLevel}
            <View style={{ paddingTop: 10, paddingBottom: 6 }}>{chains}</View>
            {links}
          </View>
        </View>

        {/* Room for the pinned step below. */}
        <View style={{ height: FINISH_HEIGHT }} />
      </Screen>

      {/* The last step stays in reach however far the page is scrolled. Its strip runs down behind the floating bar. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: bar.room + insets.bottom, paddingHorizontal: gutter, paddingTop: 10, backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.border }}>
        <Btn label="Finish song" to="/cover?finish=1" style={{ flex: 0, minHeight: 52 }} />
      </View>
      <UndoToast projectId={project.id} lift={FINISH_HEIGHT + 4} />
    </View>
  );
}
