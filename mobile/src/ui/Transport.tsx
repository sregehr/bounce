// The player controls shared by the Song and Mix pages, and the choice of bars that the Song tab alone offers.
import { useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';

import type { LoopChoice, Project, Take } from '@/data/model';
import { patchProject } from '@/data/store';
import type { useSong } from '@/data/song';
import { barSeconds, barsIn, loopSeconds } from '@/data/studio';

import { Muted, NavLink, RoundPlay, SeekTrack, Segmented, Txt, s } from './kit';
import { C } from './theme';

// Repeat is one choice for the whole app: it is set on the Song tab, and the Mix page follows it.
let repeating = true;
const listeners = new Set<() => void>();
const setRepeat = (on: boolean) => {
  repeating = on;
  listeners.forEach((l) => l());
};
/** Whether the take keeps coming round when it reaches its end. Pass it to `useSong`. */
export const useRepeat = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => repeating,
    () => repeating,
  );

const LENGTHS = ['8 bars', '16 bars', 'Whole beat'] as const;

function Pill({ label, name, on, solid, onPress }: { label: string; name: string; on: boolean; solid?: boolean; onPress: () => void }) {
  const filled = on && solid;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={name}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      hitSlop={6}
      style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: on ? (solid ? C.text : C.accent) : C.borderStrong, backgroundColor: filled ? C.text : 'transparent', justifyContent: 'center' }}
    >
      <Txt size={13} w="semi" color={filled ? C.bg : on ? C.accent : C.text}>
        {label}
      </Txt>
    </Pressable>
  );
}

/**
 * Which bars of the beat a song sits over: 8 or 16 bars on loop from a chosen bar, or the whole
 * beat once through. It is set here, on the Song tab, and nowhere else: the mic records over the
 * same bars and the mix plays them. With a take picked, the take is moved too; `repeat` adds the
 * switch for whether it keeps coming round.
 */
export function LoopPicker({ project, take, repeat: withRepeat }: { project: Project; take?: Take | null; repeat?: boolean }) {
  const repeat = useRepeat();
  const beat = project.beat;
  const loop = take?.loop ?? project.loop;
  const region = loopSeconds(beat, loop);
  const total = barsIn(beat);
  const first = (region?.startBar ?? 0) + 1;
  const length = loop.bars === 8 ? '8 bars' : loop.bars === 16 ? '16 bars' : 'Whole beat';
  // The song and its picked take keep the same bars, so the next take is recorded over them too.
  const setLoop = (next: LoopChoice) => patchProject(project.id, (p) => ({ loop: next, takes: take ? p.takes.map((k) => (k.id === take.id ? { ...k, loop: next } : k)) : p.takes }));
  const timed = !!barSeconds(beat.bpm);

  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { gap: 8 }]}>
        {withRepeat && <Pill label="Repeat" name="Repeat" on={repeat} onPress={() => setRepeat(!repeat)} />}
        {timed && (
          <View style={{ flex: 1 }}>
            <Segmented options={LENGTHS} value={length} onChange={(l) => setLoop({ ...loop, bars: l === '8 bars' ? 8 : l === '16 bars' ? 16 : 0 })} variant="compact" />
          </View>
        )}
      </View>
      {!timed ? (
        <Muted size={13}>Set the tempo in the beat details to loop 8 or 16 bars of the beat. Until then the whole beat plays through.</Muted>
      ) : (
        <View style={[s.row, s.between, { minHeight: 24 }]}>
          <Txt size={13} color={C.muted}>
            {region ? `Beat bars ${first}–${first + region.bars - 1} on loop` : 'Whole beat, once through'}
          </Txt>
          {region && total > region.bars && (
            <View style={[s.row, { gap: 16 }]}>
              <NavLink size={13} style={{ minHeight: 24 }} onPress={() => setLoop({ ...loop, startBar: Math.max(0, region.startBar - 4) })}>
                4 bars earlier
              </NavLink>
              <NavLink size={13} style={{ minHeight: 24 }} onPress={() => setLoop({ ...loop, startBar: Math.min(total - region.bars, region.startBar + 4) })}>
                4 bars later
              </NavLink>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Play and the position in the take. `loop` adds Repeat and the choice of bars, for the Song tab;
 * `compare` adds the switch to the raw take, for pages that loaded it.
 */
export function Transport({ project, take, song, compare, loop }: { project: Project; take: Take; song: Pick<ReturnType<typeof useSong>, 't' | 'mix' | 'toggle' | 'seek' | 'setSide'>; compare?: boolean; loop?: boolean }) {
  const { t, mix } = song;
  const raw = t.side === 'b';

  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { gap: 8 }]}>
        <RoundPlay playing={t.playing} onPress={song.toggle} disabled={!mix} />
        <SeekTrack peaks={take.wave} height={44} progress={t.duration > 0 ? t.position / t.duration : 0} disabled={!t.loaded || t.duration <= 0} onSeek={(f) => song.seek(f * t.duration)} label="Position in take" duration={t.duration} style={{ flex: 1 }} />
        {compare && <Pill label="Raw" name="Compare with raw" on={raw} solid onPress={() => song.setSide(raw ? 'a' : 'b')} />}
      </View>
      {loop && <LoopPicker project={project} take={take} repeat />}
    </View>
  );
}
