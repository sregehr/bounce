// The player controls shared by the Song and Mix pages.
import { Pressable, View } from 'react-native';

import type { Project, Take } from '@/data/model';
import type { useSong } from '@/data/song';

import { RoundPlay, SeekTrack, Txt, s } from './kit';
import { C } from './theme';

/** A take keeps coming round when it reaches its end, on every page that plays one. Pass it to `useSong`. */
export const useRepeat = () => true;

/**
 * Held down, the raw take plays in place of the polished one; let go and the polish is back. It cannot be left on by mistake.
 * A screen reader's double tap, which has no holding, flips it instead.
 */
function HoldRaw({ raw, set }: { raw: boolean; set: (raw: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hold to hear it raw"
      accessibilityState={{ selected: raw }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => set(!raw)}
      onPressIn={() => set(true)}
      onPressOut={() => set(false)}
      // Losing focus mid-hold must not leave the raw take playing.
      onBlur={() => raw && set(false)}
      style={{ minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: raw ? C.text : C.borderStrong, backgroundColor: raw ? C.text : 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}
    >
      <Txt size={14} w="semi" color={raw ? C.bg : C.text}>
        {raw ? 'Playing it raw' : 'Hold to hear it raw'}
      </Txt>
    </Pressable>
  );
}

/**
 * Play and the position in the take, or in the beat when it is being mixed alone. Which bars of the beat a take sits over is chosen on the mic
 * screen, before it is recorded. `compare` adds the button that plays the raw take while it is held, for pages that loaded it.
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
      {compare && <HoldRaw raw={raw} set={(on) => song.setSide(on ? 'b' : 'a')} />}
    </View>
  );
}
