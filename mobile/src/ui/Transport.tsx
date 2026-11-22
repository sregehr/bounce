// The player controls shared by the Song and Mix pages.
import { Platform, Pressable, View } from 'react-native';

import type { Project, Take } from '@/data/model';
import type { useSong } from '@/data/song';

import { RoundPlay, SeekTrack, Txt, s } from './kit';
import { C } from './theme';

/** A take keeps coming round when it reaches its end, on every page that plays one. Pass it to `useSong`. */
export const useRepeat = () => true;

/**
 * Tapped, the raw take plays in place of the polished one; tapped again, the polish is back. It is a tap
 * and not a hold because a long press on a phone's browser starts selecting text instead. While raw is
 * on the button is filled and says so, so it is not left on unnoticed.
 */
function HearRaw({ raw, set }: { raw: boolean; set: (raw: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Hear it raw"
      accessibilityState={{ checked: raw }}
      onPress={() => set(!raw)}
      style={({ pressed }) => [{ minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: raw ? C.text : C.borderStrong, backgroundColor: raw ? C.text : 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, opacity: pressed ? 0.7 : 1 }, Platform.OS === 'web' && ({ userSelect: 'none' } as object)]}
    >
      <Txt size={14} w="semi" color={raw ? C.bg : C.text}>
        {raw ? 'Playing it raw · tap for the polish' : 'Hear it raw'}
      </Txt>
    </Pressable>
  );
}

/**
 * Play and the position in the take, or in the beat when it is being mixed alone. Which bars of the beat a take sits over is chosen on the mic
 * screen, before it is recorded. `compare` adds the button that switches to the raw take and back, for pages that loaded it.
 */
export function Transport({ project, take, song, compare }: { project: Project; /** The take being played, or none when it is the beat alone. */ take: Take | null; song: Pick<ReturnType<typeof useSong>, 't' | 'mix' | 'toggle' | 'seek' | 'setSide'>; compare?: boolean }) {
  const { t, mix } = song;
  const raw = t.side === 'b';

  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { gap: 8 }]}>
        <RoundPlay playing={t.playing} onPress={song.toggle} disabled={!mix} />
        <SeekTrack peaks={take ? take.wave : project.beat.wave} height={44} progress={t.duration > 0 ? t.position / t.duration : 0} disabled={!t.loaded || t.duration <= 0} onSeek={(f) => song.seek(f * t.duration)} label={take ? 'Position in take' : 'Position in beat'} duration={t.duration} style={{ flex: 1 }} />
      </View>
      {compare && <HearRaw raw={raw} set={(on) => song.setSide(on ? 'b' : 'a')} />}
    </View>
  );
}
