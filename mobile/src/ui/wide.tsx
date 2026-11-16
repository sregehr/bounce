import type { ReactNode } from 'react';
import { View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

/** Width of the navigation rail down the left edge of the wide layout. */
export const RAIL_WIDTH = 96;
/** The widest the wide layout grows on a big display; beyond it the app sits centred. */
export const WIDE_MAX = 1440;

/**
 * Whether there is room for the wide layout: a tablet on its side, or a desktop browser window.
 * A phone, a tablet held upright, and a narrow Split View all keep the phone layout.
 */
export function useWide() {
  const { width, height } = useWindowDimensions();
  return width >= 1000 && width > height;
}

/**
 * Two panes side by side in the wide layout, filling the height left under the header.
 * `side` is the fixed width of the right pane; without it the two share the room.
 */
export function Columns({ left, right, side, gap = 40, inner = 16, style }: { left: ReactNode; right: ReactNode; side?: number; gap?: number; inner?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flex: 1, flexDirection: 'row', gap, minHeight: 0 }, style]}>
      <View style={{ flex: 1, minWidth: 0, gap: inner }}>{left}</View>
      <View style={[side ? { width: side } : { flex: 1, minWidth: 0 }, { gap: inner }]}>{right}</View>
    </View>
  );
}
