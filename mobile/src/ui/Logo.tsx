import Svg, { Circle, Rect } from 'react-native-svg';

import { C } from './theme';

/**
 * The Bounce mark: four pads, as on an MPC, with one of them a ball. The app icons in assets/
 * are the same drawing on the app's background, so change both together.
 */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 62 62">
      <Rect x={0} y={0} width={27} height={27} rx={7} fill={C.text} />
      <Rect x={35} y={0} width={27} height={27} rx={7} fill={C.text} />
      <Rect x={0} y={35} width={27} height={27} rx={7} fill={C.text} />
      <Circle cx={48.5} cy={48.5} r={14.5} fill={C.accent} />
    </Svg>
  );
}
