import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Redirect } from 'expo-router';

import { activeTake, deleteTake, patchProject, useProject } from '@/data/store';
import { useSong } from '@/data/song';
import { VOCAL_STYLES, type Polish } from '@/dsp/presets';
import { Btn, Chip, Chips, Disclosure, Eyebrow, Foot, Muted, NavLink, Option, RoundPlay, Screen, SeekTrack, Segmented, SliderRow, TickIcon, TopBar, Txt, s } from '@/ui/kit';
import { useArmed, useStopOnLeave } from '@/ui/hooks';
import { C, clock } from '@/ui/theme';

const SIDES = ['Raw take', 'Polished'] as const;

export default function Playback() {
  const project = useProject();
  const take = activeTake(project);
  const song = useSong(take ? project : null, { compare: true });
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<number | null>(null);
  const [armed, arm] = useArmed();
  useStopOnLeave();

  if (!project) return <Redirect href="/" />;
  if (!take) return <Redirect href="/vocals" />;

  const { t, mix } = song;
  const polish = project.polish;
  const setPolish = (patch: Partial<Polish>) => patchProject(project.id, { polish: { ...polish, ...patch } });
  const side = t.side === 'b' ? 'Raw take' : 'Polished';
  const progress = t.duration > 0 ? t.position / t.duration : 0;
  const status = song.error ? 'could not render' : song.busy ? (mix ? 'updating' : 'working') : t.playing ? 'playing' : 'ready';
  const steps = ['Lined up with the beat', mix?.did.noiseReduced === false ? 'Take was already clean' : 'Background noise lowered', 'Chain matched to your voice', 'Levels balanced with the beat'];
  const origin = take.origin === 'kept' ? ' · kept from the last 60 s' : take.origin === 'punched' ? ' · punched in' : '';

  return (
    <Screen>
      <TopBar left={<Eyebrow accent={!song.error} color={song.error ? C.recText : undefined}>{`Auto polish · ${status}`}</Eyebrow>} right={<NavLink to="/vocals" back>Back</NavLink>} />

      <View style={{ gap: 6 }}>
        <Txt size={40} w="display" ls={-0.03} lh={1}>
          Take {take.number}
        </Txt>
        <Muted size={15}>
          {song.error ?? `${project.name} · ${clock(mix?.durationSec ?? take.durationSec)}${song.busy && !mix ? ` · ${song.stage || 'polishing'}…` : song.took ? ` · ready in ${song.took < 10 ? song.took.toFixed(1) : Math.round(song.took)} s` : ''}${origin}`}
        </Muted>
      </View>

      <Segmented options={SIDES} value={side} onChange={(v) => song.setSide(v === 'Raw take' ? 'b' : 'a')} />

      <View style={[s.row, { gap: 12 }]}>
        <RoundPlay playing={t.playing} onPress={song.toggle} disabled={!t.loaded} />
        <SeekTrack peaks={take.wave} height={44} progress={progress} disabled={!t.loaded || t.duration <= 0} onSeek={(f) => song.seek(f * t.duration)} label="Position in take" style={{ flex: 1 }} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
        {steps.map((label) => (
          <View key={label} style={[s.row, { gap: 8, width: '50%', paddingRight: 8 }]}>
            <TickIcon />
            <Txt size={13} w="medium" style={{ flex: 1 }}>
              {label}
            </Txt>
          </View>
        ))}
      </View>

      <Chips options={VOCAL_STYLES} value={polish.style} onChange={(style) => patchProject(project.id, (p) => ({ polish: { ...p.polish, style }, overrides: { ...p.overrides, vocal: undefined } }))} />

      {project.takes.length > 1 && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {project.takes.map((k) => (
            <Chip key={k.id} label={`Take ${k.number}`} on={k.id === take.id} onPress={() => patchProject(project.id, { takeId: k.id }, false)} style={{ minHeight: 36 }} />
          ))}
        </View>
      )}

      <Disclosure title="Tweak it" summary={open ? 'Hide' : 'Show'} open={open} onToggle={() => setOpen(!open)} last size={15}>
        <View>
          <Option label="Double track, nudged and panned" w="regular" checked={polish.double} onChange={(double) => setPolish({ double })} minHeight={46} />
          <SliderRow label="Vocal level" value={level ?? polish.vocalLevel} onChange={setLevel} onCommit={(v) => (setLevel(null), setPolish({ vocalLevel: v }))} labelWidth={92} minHeight={44} fontSize={15} display={`${level ?? polish.vocalLevel}`} valueWidth={30} />
          <NavLink to="/advanced" size={15} w="semi">
            Advanced: EQ, compressor, de-esser, limiter ›
          </NavLink>
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
      </Disclosure>

      <Foot>
        <Btn kind="light" label="Run it back" to="/vocals" back />
        <View style={[s.row, { gap: 10 }]}>
          <Btn kind="outline" label="Keep" to="/vault" style={{ flex: 1, borderRadius: 14 }} />
          <Btn kind="outline" label="Snippet" to="/snippet" style={{ flex: 1, borderRadius: 14 }} />
          <Btn kind="outline" label="Master" to="/master" style={{ flex: 1, borderRadius: 14 }} />
        </View>
      </Foot>
    </Screen>
  );
}
