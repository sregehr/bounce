import { createContext, useContext, type ReactNode } from 'react';
import { View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

/**
 * True inside a sheet the system draws (a page sheet on an iPad is a column about as wide as the
 * phone layouts are designed for, whatever the size of the screen behind it). Screens in one
 * keep the single column and its ordinary margins.
 */
export const Narrow = createContext(false);

/** The widest the wide layout grows on a big display; beyond it the app sits centred. */
export const WIDE_MAX = 1440;

/**
 * Whether there is room for the wide, two-pane layout: a tablet on its side, or a desktop browser window.
 * A phone, a tablet held upright, and a narrow Split View keep the single column; see `useRoomy`.
 */
export function useWide() {
  const { width, height } = useWindowDimensions();
  const narrow = useContext(Narrow);
  return !narrow && width >= 1000 && width > height;
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

/** From this width up, the single column stops being a phone's: a tablet held upright, or sharing the screen. */
const ROOMY_FROM = 600;
/** The widest the single column of content grows; a line of text much longer than this is hard to read. */
export const READ_WIDTH = 640;

/**
 * The measurements of the floating bottom bar. A tablet is held further from the eye and has the
 * room, so its bar is a size up from the phone's: taller, with larger icons, labels and mic.
 * `max` is the widest the capsule grows, so its tabs stay within reach of each other, and `room`
 * is what the bar takes up with the gap around it, not counting the home-indicator inset below.
 */
export function useBar() {
  const { width } = useWindowDimensions();
  return width >= ROOMY_FROM
    ? { height: 76, mic: 76, glyph: 31, label: 12.5, max: 620, lift: 18, room: 100 }
    : { height: 64, mic: 64, glyph: 26, label: 10.5, max: 520, lift: 12, room: 84 };
}

/**
 * A single column with room around it: a tablet held upright, a wide Split View, or a tall
 * browser window. The screen is used edge to edge, with the content in a readable column down the
 * middle, rather than a phone-sized strip.
 */
export function useRoomy() {
  const { width } = useWindowDimensions();
  const narrow = useContext(Narrow);
  return !useWide() && !narrow && width >= ROOMY_FROM;
}

/** The margin either side of single-column content: `base` on a phone, and whatever centres the column when there is room. */
export function useGutter(base = 24) {
  const { width } = useWindowDimensions();
  return useRoomy() ? Math.max(base, Math.round((width - READ_WIDTH) / 2)) : base;
}
