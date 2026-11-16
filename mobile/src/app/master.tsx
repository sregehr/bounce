import { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';

import { activeTake, patchProject, useProject } from '@/data/store';
import { useSong } from '@/data/song';
import { MASTER_STYLES, type MasterSettings } from '@/dsp/presets';
import { Btn, Card, Chip, Eyebrow, Foot, NavLink, Screen, Segmented, Slider, SliderRow, TopBar, Txt, s } from '@/ui/kit';
import { useStopOnLeave } from '@/ui/hooks';
import { MiniTransport } from '@/ui/parts';
import { C, db, lufs } from '@/ui/theme';

const SIDES = ['Original', 'Mastered'] as const;
const fine = { labelWidth: 92, valueWidth: 50, minHeight: 44 };

export default function Master() {
  const project = useProject();
  const take = activeTake(project);
  const song = useSong(project, { compare: true });
  // Values being dragged; the master is redone when the slider is let go.
  const [draft, setDraft] = useState<Partial<MasterSettings>>({});
  useStopOnLeave();

  if (!project) return <Redirect href="/" />;

  const master = { ...project.master, ...draft };
  const commit = (patch: Partial<MasterSettings>) => {
    setDraft({});
    // Choosing on this screen replaces any master chain set by hand on the Mix page.
    patchProject(project.id, (p) => ({ master: { ...p.master, ...patch }, overrides: { ...p.overrides, master: undefined } }));
  };
  const { t, mix } = song;
  const byHand = !!project.overrides.master;

  return (
    <Screen gap={14} padBottom={32}>
      {/* No way back here: the bar at the bottom leads everywhere, and a finished song has Done below. */}
      <TopBar left="Master" />

      <Segmented options={SIDES} value={t.side === 'b' ? 'Original' : 'Mastered'} onChange={(v) => song.setSide(v === 'Original' ? 'b' : 'a')} />
      <MiniTransport playing={t.playing} position={t.position} duration={t.duration} onToggle={song.toggle} onSeek={song.seek} busy={song.busy} />

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {MASTER_STYLES.map((style) => (
          <Chip key={style} label={style} on={style === master.style && !byHand} onPress={() => commit({ style })} />
        ))}
      </View>

      <Card style={{ borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 6 }}>
        <Eyebrow accent>{byHand ? 'Set by hand' : 'What this style did'}</Eyebrow>
        <Txt size={14} lh={1.45} color={song.error ? C.recText : C.text}>
          {song.error ?? (byHand ? 'Using the master chain you set on the Mix page. Pick a style to go back to an automatic master.' : (mix?.note ?? 'Listening to the whole track…'))}
        </Txt>
      </Card>

      <View style={{ gap: 2 }}>
        <View style={[s.row, s.between]}>
          <Txt size={15} w="semi">
            Intensity
          </Txt>
          <Txt size={14} color={C.muted}>
            {master.amount}%
          </Txt>
        </View>
        <Slider label="Intensity" value={master.amount} min={0} max={100} step={1} height={32} onChange={(amount) => setDraft({ ...draft, amount })} onCommit={(amount) => commit({ amount })} />
      </View>

      <View>
        <View style={{ paddingBottom: 4 }}>
          <Eyebrow>Fine tune</Eyebrow>
        </View>
        <SliderRow {...fine} label="Low" min={-6} max={6} step={0.5} value={master.low} display={db(master.low, master.low % 1 ? 1 : 0)} onChange={(low) => setDraft({ ...draft, low })} onCommit={(low) => commit({ low })} />
        <SliderRow {...fine} label="Mid" min={-6} max={6} step={0.5} value={master.mid} display={db(master.mid, master.mid % 1 ? 1 : 0)} onChange={(mid) => setDraft({ ...draft, mid })} onCommit={(mid) => commit({ mid })} />
        <SliderRow {...fine} label="High" min={-6} max={6} step={0.5} value={master.high} display={db(master.high, master.high % 1 ? 1 : 0)} onChange={(high) => setDraft({ ...draft, high })} onCommit={(high) => commit({ high })} />
        <SliderRow {...fine} label="Compression" value={master.comp} display={`${master.comp}%`} onChange={(comp) => setDraft({ ...draft, comp })} onCommit={(comp) => commit({ comp })} />
      </View>

      <Foot gap={14}>
        <View style={[s.row, s.between, { alignItems: 'flex-end' }]}>
          <View style={{ gap: 2 }}>
            <Txt size={12} color={C.muted}>
              {song.busy ? 'Mastering…' : 'Loudness now'}
            </Txt>
            <Txt size={24} w="display" ls={0}>
              {mix ? lufs(mix.lufs) : '– LUFS'}
            </Txt>
          </View>
          <View style={{ gap: 2, alignItems: 'flex-end' }}>
            <Txt size={12} color={C.muted}>
              True peak
            </Txt>
            <Txt size={18} w="displayMedium">
              {mix ? db(mix.truePeakDb, 1) : '– dB'}
            </Txt>
          </View>
        </View>
        {/* A song is finished by saving it to the Vault; its files are exported from there. */}
        {project.saved ? <Btn label="Done" to="/player" back disabled={!mix} /> : <Btn label="Save to the Vault" to="/cover?finish=1" disabled={!mix} />}
      </Foot>
    </Screen>
  );
}
