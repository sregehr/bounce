import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { C } from './theme';

// The take on its way to becoming a song: bar heights, the first few already played. The same beat Home draws.
const BARS = [8, 18, 30, 14, 40, 24, 52, 20, 34, 12, 22];
const PLAYED = 6;

/**
 * What the Vault shows while it holds no songs, drawn as Home's empty picture is: there a sampler, the beat and the mic
 * it is headed for; here the mic, the take, and the covers of the finished songs it ends up among. It is a picture only,
 * so screen readers skip it; the words under it say what the Vault is for.
 */
export function EmptyVault({ width = 300 }: { width?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={{ width: '100%', maxWidth: width, aspectRatio: 300 / 132 }}>
      <Svg width="100%" height="100%" viewBox="10 50 300 132" fill="none">
        {/* The mic on its stand. */}
        <Rect x={34} y={62} width={26} height={42} rx={13} stroke={C.text} strokeWidth={2.5} />
        <Path d="M24 92a23 23 0 0046 0M47 115v55M30 170h34" stroke={C.text} strokeWidth={2.5} strokeLinecap="round" />
        <Circle cx={47} cy={76} r={2.5} fill={C.accent} />
        {/* The take. */}
        {BARS.map((h, i) => (
          <Path key={i} d={`M${88 + i * 8.4} ${115 - h / 2}v${h}`} stroke={i < PLAYED ? C.accent : C.waveDim} strokeWidth={3} strokeLinecap="round" />
        ))}
        {/* The finished songs: one cover behind, and the newest in front, ready to play. */}
        <Rect x={212} y={60} width={88} height={88} rx={16} stroke={C.borderStrong} strokeWidth={2} />
        <Rect x={194} y={80} width={90} height={90} rx={18} fill={C.surface} stroke={C.borderStrong} strokeWidth={2} />
        <Path d="M231 111l22 14-22 14z" fill={C.accent} stroke={C.accent} strokeWidth={2} strokeLinejoin="round" />
      </Svg>
    </View>
  );
}
