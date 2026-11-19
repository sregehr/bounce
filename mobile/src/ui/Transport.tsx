// The player controls shared by the Song and Mix pages.
import { Pressable, View } from 'react-native';

import type { Project, Take } from '@/data/model';
import type { useSong } from '@/data/song';

import { RoundPlay, SeekTrack, Txt, s } from './kit';
import { C } from './theme';

/** A take keeps coming round when it reaches its end, on every page that plays one. Pass it to `useSong`. */
export const useRepeat = () => true;

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
 * Play and the position in the take. Which bars of the beat a take sits over is chosen on the mic
 * screen, before it is recorded. `compare` adds the switch to the raw take, for pages that loaded it.
 */
export function Transport({ take, song, compare }: { project: Project; take: Take; song: Pick<ReturnType<typeof useSong>, 't' | 'mix' | 'toggle' | 'seek' | 'setSide'>; compare?: boolean }) {
  const { t, mix } = song;
  const raw = t.side === 'b';

  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { gap: 8 }]}>
        <RoundPlay playing={t.playing} onPress={song.toggle} disabled={!mix} />
        <SeekTrack peaks={take.wave} height={44} progress={t.duration > 0 ? t.position / t.duration : 0} disabled={!t.loaded || t.duration <= 0} onSeek={(f) => song.seek(f * t.duration)} label="Position in take" duration={t.duration} style={{ flex: 1 }} />
        {compare && <Pill label="Raw" name="Compare with raw" on={raw} solid onPress={() => song.setSide(raw ? 'a' : 'b')} />}
      </View>
    </View>
  );
}
