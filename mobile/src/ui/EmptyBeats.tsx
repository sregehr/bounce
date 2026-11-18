import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { Muted, Txt } from './kit';
import { C } from './theme';

// The pads of the sampler, left to right and top to bottom. The lit one is the pad being played.
const PADS = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ x: 34 + col * 30, y: 74 + row * 30, lit: row === 1 && col === 2 })));
// The beat on its way to the mic: bar heights, the first few already played.
const BARS = [8, 18, 30, 14, 40, 24, 52, 20, 34, 12, 22];
const PLAYED = 6;

/**
 * What Home shows in place of the list of beats while there are none: a sampler, the beat
 * coming out of it, and the mic it is headed for. It is a picture only, so screen readers skip it;
 * the caption under it says the same thing in words.
 */
export function EmptyBeats({ caption, width = 300 }: { caption?: boolean; width?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: 18 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={{ width: '100%', maxWidth: width, aspectRatio: 300 / 132 }}>
        <Svg width="100%" height="100%" viewBox="10 50 300 132" fill="none">
          {/* The sampler. */}
          <Rect x={20} y={60} width={110} height={110} rx={18} fill={C.surface} stroke={C.borderStrong} strokeWidth={2} />
          {PADS.map((p) => (
            <Rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={22} height={22} rx={6} fill={p.lit ? C.accent : 'none'} stroke={p.lit ? C.accent : C.borderStrong} strokeWidth={2} />
          ))}
          {/* The beat. */}
          {BARS.map((h, i) => (
            <Path key={i} d={`M${152 + i * 8.4} ${115 - h / 2}v${h}`} stroke={i < PLAYED ? C.accent : C.waveDim} strokeWidth={3} strokeLinecap="round" />
          ))}
          {/* The mic on its stand. */}
          <Rect x={262} y={62} width={26} height={42} rx={13} stroke={C.text} strokeWidth={2.5} />
          <Path d="M252 92a23 23 0 0046 0M275 115v55M258 170h34" stroke={C.text} strokeWidth={2.5} strokeLinecap="round" />
          <Circle cx={275} cy={76} r={2.5} fill={C.accent} />
        </Svg>
      </View>
      {caption && (
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Txt size={18} w="display" ls={0} center>
            Your beats land here
          </Txt>
          <Muted size={14} center>
            Bring one in and it waits here, ready to rap over.
          </Muted>
        </View>
      )}
    </View>
  );
}
