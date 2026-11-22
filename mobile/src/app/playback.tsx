import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { activeTake, deleteTake, patchProject, setSettings, useLibrary, useProject, redoMix, switchMix, undoMix, useMixHistory } from '@/data/store';
import { fileBase } from '@/data/exporting';
import { saveFiles } from '@/data/files';
import { matchNote } from '@/data/match';
import { useSong } from '@/data/song';
import { getMix, loadPcm } from '@/data/studio';
import { encodeWav } from '@/dsp/wav';
import { VOCAL_STYLES, type Polish } from '@/dsp/presets';
import { NoSong } from '@/ui/AddBeat';
import { Btn, Chips, Eyebrow, Muted, Option, Screen, Segmented, SliderRow, TopBar, Txt, s } from '@/ui/kit';
import { useStopOnLeave, useTask, useTwoFingerUndo } from '@/ui/hooks';
import { DotMenu, type MenuItem } from '@/ui/DotMenu';
import { ChainEditor } from '@/ui/ChainEditor';
import { StatusLine, UndoToast } from '@/ui/parts';
import { SavedMixes } from '@/ui/SavedMixes';
import { SongHeader } from '@/ui/SongHeader';
import { Transport, useRepeat } from '@/ui/Transport';
import { C, clock } from '@/ui/theme';
import { useBar, useGutter, useWide } from '@/ui/wide';

// Height of the pinned last step, above the floating bar.
const FINISH_HEIGHT = 62;
// Width of the left pane in the wide layout: the transport and the broad strokes.
const LISTEN_WIDTH = 400;

const MIX_SIDES = ['Mix A', 'Mix B'] as const;

/** Undo or redo as a small arrow, beside the menu: there when wanted, without competing with the mix's own controls. */
function Step({ label, back, on, onPress }: { label: string; back?: boolean; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !on }} onPress={() => on && onPress()} hitSlop={4} style={({ pressed }) => ({ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: !on ? 0.3 : pressed ? 0.55 : 1 })}>
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" style={back ? undefined : { transform: [{ scaleX: -1 }] }}>
        <Path d="M9 7 4.5 11.5 9 16" stroke={C.text} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M5 11.5h9a5 5 0 0 1 0 10h-2" stroke={C.text} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Pressable>
  );
}

export default function Playback() {
  const project = useProject();
  const take = activeTake(project);
  // The mix keeps coming round while it is being shaped, unless Repeat is turned off.
  const repeat = useRepeat();
  // With a second mix to flip to, the louder of the two is turned down to the other while listening here.
  // With no take picked it is the beat alone that is mixed: the same page, without the vocal's controls.
  const song = useSong(project && !project.saved ? project : null, { compare: true, repeat, match: project?.mixAlt ? project.mixAltLoud : undefined });
  const insets = useSafeAreaInsets();
  const gutter = useGutter();
  const bar = useBar();
  const [level, setLevel] = useState<number | null>(null);
  // Mix has two levels on a phone: the sound, and the fine-tuning one step in. It opens on whichever was open last.
  const tuning = useLibrary((l) => !!l.settings.fineTune);
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
  // A tap with two fingers takes back the last change to the mix.
  useTwoFingerUndo(() => !!projectId && undoMix(projectId));

  if (!project || project.saved) return <NoSong title="Nothing to mix yet" about="Add a beat and record a take over it, and the mix opens here." />;
  const { mix } = song;
  const polish = project.polish;
  const setPolish = (patch: Partial<Polish>) => patchProject(project.id, { polish: { ...polish, ...patch } });
  const state = song.error ? 'Could not render' : song.busy ? (mix ? 'Updating…' : take ? 'Polishing…' : 'Mastering…') : take ? 'Polished' : 'Mastered';
  // The take set aside to mix the beat alone, if the song has any.
  const newest = project.takes[project.takes.length - 1];
  /** The untouched parts an engineer would want: the beat, the raw vocal, and the processed vocal. */
  const sendStems = () =>
    !!take &&
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

  // The lesser things a mix can do, behind three dots.
  const menu: MenuItem[] = take
    ? [
        { label: stems.busy ? 'Gathering the stems…' : 'Send stems to an engineer', onPress: () => !stems.busy && void sendStems() },
        { label: 'Mix the beat alone', onPress: () => patchProject(project.id, { takeId: null }, false) },
        // Undo on the Song tab brings a deleted take back, so it is not asked about first.
        { label: `Delete take ${take.number}`, danger: true, onPress: () => deleteTake(project.id, take.id) },
      ]
    : [];
  // Where the mix stands, with stepping back and forth through its changes and the menu beside it.
  const standing = (
    <View style={{ gap: 6 }}>
      <View style={[s.row, { gap: 4, minHeight: 40 }]}>
        <View style={{ flex: 1 }}>
          <StatusLine done={vaulted > 0} parts={[take ? `Take ${take.number} · ${clock(take.durationSec)}` : 'Beat only', state, vaulted === 0 ? 'Not in the Vault yet' : vaulted === 1 ? 'In the Vault' : `${vaulted} in the Vault`]} />
        </View>
        <Step label="Undo" back on={history.canUndo} onPress={() => undoMix(project.id)} />
        <Step label="Redo" on={history.canRedo} onPress={() => redoMix(project.id)} />
        {menu.length > 0 && <DotMenu label="More for this mix" items={menu} />}
      </View>
      {(song.error || stems.busy || stems.error || sent) && (
        <Txt size={13} color={song.error || stems.error ? C.recText : C.muted}>
          {song.error ?? (stems.busy ? 'Gathering the stems…' : (stems.error ?? sent))}
        </Txt>
      )}
    </View>
  );
  const header = (
    <View style={{ gap: 10 }}>
      <SongHeader project={project} />
      {standing}
    </View>
  );

  const listen = (
        <View style={{ gap: 12 }}>
          <Transport project={project} take={take} song={song} compare />
          {/* The beat by itself: what that means, and the way to put a vocal on it. */}
          {!take && (
            <View style={{ gap: 10 }}>
              <Muted size={14}>{newest ? `The beat by itself, with take ${newest.number} set aside. Its sound is shaped under Beat and Master.` : 'The beat by itself. Shape its sound under Beat and Master, or record a take and it joins the mix.'}</Muted>
              {newest ? <Btn kind="outline" label={`Mix with take ${newest.number}`} onPress={() => patchProject(project.id, { takeId: newest.id }, false)} style={{ flex: 0 }} /> : <Btn kind="outline" label="Record a take" to="/vocals" style={{ flex: 0 }} />}
            </View>
          )}
          {take && <Eyebrow>Vocal sound</Eyebrow>}
          {take && <Chips options={VOCAL_STYLES} value={polish.style} onChange={(style) => patchProject(project.id, (p) => ({ polish: { ...p.polish, style }, overrides: { ...p.overrides, vocal: undefined }, space: p.space && { ...p.space, vocal: { ...p.space.vocal, reverb: undefined } } }))} />}
        </View>
  );

  const double = take && <Option label="Double track" sub="A second copy, nudged and panned" w="regular" checked={polish.double} onChange={(double) => setPolish({ double })} minHeight={46} />;
  const vocalLevel = take && <SliderRow label="Vocal level" value={level ?? polish.vocalLevel} onChange={setLevel} onCommit={(v) => (setLevel(null), setPolish({ vocalLevel: v }))} labelWidth={92} minHeight={44} fontSize={15} display={`${level ?? polish.vocalLevel}`} valueWidth={30} />;
  const chains = <ChainEditor project={project} song={song} />;

  // Two mixes to flip between while it plays.
  const side = project.mixSide ?? 'A';
  const compare = (
    <View>
      <View style={[s.row, s.between, { gap: 12, minHeight: 44 }]}>
        <Eyebrow>Compare</Eyebrow>
        <View style={{ width: 168 }}>
          <Segmented options={MIX_SIDES} value={side === 'A' ? 'Mix A' : 'Mix B'} onChange={(v) => switchMix(project.id, v === 'Mix A' ? 'A' : 'B')} variant="compact" />
        </View>
      </View>
      {/* Two mixes are only a fair comparison at the same level. */}
      {project.mixAlt && <Muted size={13}>{matchNote(song.trimDb, side)}</Muted>}
    </View>
  );
  const saved = <SavedMixes project={project} />;

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
              {vocalLevel}
              {double}
              {compare}
              {saved}
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>{chains}</View>
        </View>
      </Screen>
      <UndoToast projectId={project.id} />
      </View>
    );

  // The way one step in, saying what is there.
  const toTune = (
    <Pressable accessibilityRole="button" accessibilityLabel="Fine-tune. EQ, compressor, reverb, compare A and B, saved mixes" onPress={() => setSettings({ fineTune: true })} style={({ pressed }) => [s.row, s.between, { minHeight: 64, gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size={16} w="semi">
          Fine-tune
        </Txt>
        <Txt size={13} color={C.muted}>
          EQ, compressor, reverb · compare A/B · saved mixes
        </Txt>
      </View>
      <Txt size={20} color={C.muted} lh={1}>
        ›
      </Txt>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen gap={tuning ? 14 : 18}>
        {tuning ? (
          <>
            {/* One step in: comparing, keeping and the chains, with the player still in reach. */}
            <TopBar back={{ onBack: () => setSettings({ fineTune: false }), label: 'Back to the sound' }} left="Fine-tune" />
            {standing}
            <Transport project={project} take={take} song={song} compare />
            <View>
              {compare}
              {saved}
              <View style={{ paddingTop: 10, paddingBottom: 6 }}>{chains}</View>
            </View>
          </>
        ) : (
          <>
            {header}
            {listen}
            <View>
              {vocalLevel}
              {double}
              {/* Once there is a second mix, which one is playing is part of the sound, so the switch shows here too. */}
              {project.mixAlt ? compare : null}
            </View>
            {toTune}
          </>
        )}

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
