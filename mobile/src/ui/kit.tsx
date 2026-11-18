import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Easing,
  Animated,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { router, useIsFocused, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { getLibrary } from '@/data/store';
import { BUBBLE_HEIGHT, bubblePlace } from './bubble';
import { reachedDetent } from './feel';
import { Collapse, Halo, NATIVE, useGlide, useReduceMotion } from './motion';
import { tick } from './haptics';
import { BackButton, SHEET_TOP, useSheet } from './nav';
import { actionDir, percentText, positionText, stepFraction } from './spoken';
import { TOP_NAV_HEIGHT, hidesTabBar, tabFor } from './tabs';
import { useBar, useWide, useGutter } from './wide';
import { C, F, type Weight } from './theme';
import { MAX_TEXT_SCALE, useDrawScale, useLargeText, useTextScale } from './type';

// ---------- Text ----------

export function Txt({
  children,
  size = 15,
  w = 'regular',
  color = C.text,
  lh,
  ls,
  center,
  right,
  upper,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  w?: Weight;
  color?: string;
  /** Line height as a multiple of the font size. */
  lh?: number;
  /** Letter spacing in em. */
  ls?: number;
  center?: boolean;
  right?: boolean;
  upper?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const display = w === 'display' || w === 'displayMedium';
  // The phone enlarges the text itself; in a browser it is done here (see `type.ts`).
  const drawn = size * useDrawScale();
  return (
    <Text
      // Larger text sizes from the system are honoured up to a point; past it, fixed rows and bars stop fitting.
      maxFontSizeMultiplier={MAX_TEXT_SCALE}
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: F[w],
          fontSize: drawn,
          color,
          letterSpacing: (ls ?? (w === 'display' ? -0.02 : 0)) * drawn,
          lineHeight: Math.round(drawn * (lh ?? (display ? 1.15 : 1.35))),
          textAlign: center ? 'center' : right ? 'right' : undefined,
          textTransform: upper ? 'uppercase' : undefined,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Eyebrow({ children, accent, color, size = 12 }: { children: ReactNode; accent?: boolean; color?: string; size?: number }) {
  return (
    <Txt size={size} w="semi" ls={0.08} upper color={color ?? (accent ? C.accent : C.muted)}>
      {children}
    </Txt>
  );
}

export function Muted({ children, size = 14, center, lh = 1.45, style }: { children: ReactNode; size?: number; center?: boolean; lh?: number; style?: StyleProp<TextStyle> }) {
  return (
    <Txt size={size} color={C.muted} center={center} lh={lh} style={style}>
      {children}
    </Txt>
  );
}

// ---------- Layout ----------

/** Full-height phone screen. `gap` and `padBottom` vary per screen in the design. */
/** How far down each tab was scrolled when it was last left, by screen and song. */
const places = new Map<string, number>();
const TAB_ROOTS = ['/', '/song', '/vocals', '/playback', '/vault'];

export function Screen({
  gap = 12,
  padBottom,
  padX = 24,
  style,
  children,
  scroll = true,
}: {
  gap?: number;
  padBottom?: number;
  padX?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  // On tabbed screens the content runs under the floating bar, so it ends clear of it.
  // The path is this screen's own: while a sheet is open over it, the screen underneath is still
  // on show behind the sheet and must not lay itself out again for the sheet's path.
  const at = usePathname();
  const held = useRef(at);
  if (useIsFocused()) held.current = at;
  const pathname = held.current;
  const tabbed = tabFor(pathname) !== null;
  // A sheet has no status bar above it, only its grabber.
  const sheet = useSheet();
  const top = sheet ? SHEET_TOP + 4 : Math.max(60, insets.top + 16);
  const { width } = useWindowDimensions();
  // The wide layout has the same bars above and below, with wider margins either side of its two panes.
  const wide = useWide();
  const bar = useBar();
  const padTop = tabbed ? insets.top + TOP_NAV_HEIGHT + 16 : top;
  const padEnd = tabbed && !hidesTabBar(pathname) ? bar.room + insets.bottom + 16 : (padBottom ?? Math.max(28, insets.bottom + 12));
  // With room to spare the column is centred rather than stretched.
  const column = useGutter(padX);
  // A sheet floating on a bigger screen is its own column, with margins to suit its width, not the window's.
  const gutter = sheet ? (Platform.OS === 'web' && width >= 600 ? 40 : padX) : column;
  const content: ViewStyle = wide
    ? {
        flexGrow: 1,
        gap,
        paddingLeft: sheet ? 36 : insets.left + 40,
        paddingRight: sheet ? 36 : insets.right + 40,
        paddingTop: tabbed ? padTop + 8 : sheet ? SHEET_TOP + 10 : Math.max(36, insets.top + 16),
        paddingBottom: tabbed && !hidesTabBar(pathname) ? padEnd : Math.max(28, insets.bottom + 12),
      }
    : {
        flexGrow: 1,
        gap,
        paddingHorizontal: gutter,
        paddingTop: padTop,
        paddingBottom: padEnd,
      };
  // A tab comes back where it was left: switching away and back should not lose your place.
  const place = TAB_ROOTS.includes(pathname) ? `${pathname}:${getLibrary().currentId ?? ''}` : null;
  const view = useRef<ComponentRef<typeof ScrollView>>(null);
  const restored = useRef(false);
  // A screen that is still loading is too short to reach the old place at first, so it is put
  // back a few times as the page fills in, and left alone as soon as the user scrolls.
  useEffect(() => {
    const y = place ? (places.get(place) ?? 0) : 0;
    if (y <= 0) return void (restored.current = true);
    const timers = [0, 80, 250, 600, 1200].map((ms, i, all) =>
      setTimeout(() => {
        if (restored.current) return;
        view.current?.scrollTo({ y, animated: false });
        if (i === all.length - 1) restored.current = true;
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: C.bg }, content, style]}>{children}</View>;
  return (
    <ScrollView
      ref={view}
      scrollEventThrottle={64}
      // Nothing is noted down until the old place has been put back, or the page would record where it was stopped short.
      onScroll={place ? (e) => void (restored.current && places.set(place, e.nativeEvent.contentOffset.y)) : undefined}
      onScrollBeginDrag={() => void (restored.current = true)}
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={[content, style]}
      keyboardShouldPersistTaps="handled"
      // On the phone the keyboard pushes the page up so the field being typed in stays in view,
      // and dragging the page down puts the keyboard away.
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/**
 * The title row at the top of a screen. `back` puts the one way out in the top-left corner
 * before the title: a chevron on a pushed screen, a cross on a sheet. Tabs have none.
 */
export function TopBar({ left, right, back }: { left: ReactNode; right?: ReactNode; back?: true | Parameters<typeof BackButton>[0] }) {
  return (
    <View style={[s.topbar, back ? { justifyContent: 'flex-start', gap: 2 } : null]}>
      {back ? <BackButton {...(back === true ? {} : back)} /> : null}
      {typeof left === 'string' ? (
        <Txt size={26} w="display" style={{ flexShrink: 1, flexGrow: back ? 1 : 0 }}>
          {left}
        </Txt>
      ) : (
        left
      )}
      {right}
    </View>
  );
}

/** Pushes whatever follows to the bottom of the screen, like the design's footer. */
export function Foot({ children, gap = 10, center, style }: { children: ReactNode; gap?: number; center?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexGrow: 1, justifyContent: 'flex-end', gap, alignItems: center ? 'center' : 'stretch' }, style]}>{children}</View>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

/** React Native for Web adds `hovered` to a Pressable's state; the types do not know about it. */
type Hover = { pressed: boolean; hovered?: boolean };

// ---------- Navigation ----------

export type Nav = { to?: Href; replace?: boolean; back?: boolean; home?: boolean; onPress?: () => void };

/**
 * Runs the tap handler, then navigates. `back` returns to the previous screen when there is
 * one; `home` closes everything above the home screen.
 */
export function go({ to, replace, back, home, onPress }: Nav) {
  onPress?.();
  if (home) {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  } else if (back && router.canGoBack()) router.back();
  else if (to) (replace || back ? router.replace : router.push)(to);
}

export function NavLink({ children, center, size = 15, w = 'medium', style, ...nav }: Nav & { children: ReactNode; center?: boolean; size?: number; w?: Weight; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => go(nav)}
      hitSlop={6}
      style={[{ minHeight: 44, justifyContent: 'center', alignItems: center ? 'center' : 'flex-start' }, style]}
    >
      {(press) => (
        <Txt size={size} w={w} color={(press as Hover).hovered ? C.accentHover : C.accent} style={{ textDecorationLine: 'underline' }}>
          {children}
        </Txt>
      )}
    </Pressable>
  );
}

// ---------- Buttons ----------

export function Btn({
  label,
  kind = 'primary',
  disabled,
  busy,
  style,
  size,
  ...nav
}: Nav & { label: string; kind?: 'primary' | 'light' | 'outline'; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; size?: number }) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={() => go(nav)}
      style={({ pressed, hovered }: Hover) => [
        s.btn,
        kind === 'primary' && { backgroundColor: hovered ? C.accentHover : C.accent },
        kind === 'light' && { backgroundColor: C.text, borderRadius: 18, minHeight: 64 },
        kind === 'outline' && { backgroundColor: 'transparent', borderWidth: 1, borderColor: hovered ? C.muted : C.borderStrong, minHeight: 52, paddingHorizontal: 6 },
        off && { opacity: 0.4 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={kind === 'outline' ? C.text : C.bg} />
      ) : kind === 'outline' ? (
        <Txt size={size ?? 15} w="semi" center>
          {label}
        </Txt>
      ) : (
        <Txt size={size ?? (kind === 'light' ? 22 : 18)} w="display" color={C.bg} center>
          {label}
        </Txt>
      )}
    </Pressable>
  );
}

export function RoundPlay({ playing, onPress, size = 44, label, icon = 16, disabled }: { playing?: boolean; onPress?: () => void; size?: number; label?: string; icon?: number; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? (playing ? 'Pause' : 'Play')}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }]}
    >
      {playing ? <PauseIcon size={icon + 2} color={C.bg} /> : <PlayIcon size={icon} color={C.bg} />}
    </Pressable>
  );
}

// ---------- Segmented + chips ----------

export function Segmented<T extends string>({ options, value, onChange, variant }: { options: readonly T[]; value: T; onChange: (v: T) => void; variant?: 'inset' | 'compact' }) {
  const inset = variant === 'inset';
  return (
    <View style={[s.segmented, inset && { backgroundColor: C.bg, borderWidth: 0, borderRadius: 12 }]}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => (o !== value && tick(), onChange(o))}
            style={[s.segment, { borderRadius: inset ? 9 : 10 }, on && { backgroundColor: C.text }]}
          >
            <Txt size={variant ? 14 : 15} w="semi" center color={on ? C.bg : C.muted}>
              {o}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, on, onPress, square, style, hint }: { label: string; on?: boolean; onPress?: () => void; square?: boolean; style?: StyleProp<ViewStyle>; /** What the chip is read out as, when its label alone would not say: "Line 2 later". */ hint?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      accessibilityState={{ selected: !!on }}
      onPress={onPress}
      style={[s.chip, square && { borderRadius: 12, paddingHorizontal: 0, flex: 1 }, on && { backgroundColor: C.text, borderColor: C.text }, style]}
    >
      <Txt size={square ? 13 : 14} w="semi" color={on ? C.bg : C.text}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function Chips<T extends string>({ options, value, onChange, wrap }: { options: readonly T[]; value: T; onChange: (v: T) => void; wrap?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: wrap ? 'wrap' : 'nowrap' }}>
      {options.map((o) => (
        <Chip key={o} label={o} on={o === value} onPress={() => onChange(o)} />
      ))}
    </View>
  );
}

// ---------- Waveform bars + meters ----------

export type Bar = { h: number; c?: string };

export function Bars({ bars, height, color = C.text, style }: { bars: Bar[]; height: number; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View accessible={false} style={[{ height, flexDirection: 'row', alignItems: 'center', gap: 2, overflow: 'hidden' }, style]}>
      {bars.map((b, i) => (
        <View key={i} style={{ width: 3, height: Math.max(2, Math.min(height, b.h)), borderRadius: 2, backgroundColor: b.c ?? color }} />
      ))}
    </View>
  );
}

/**
 * A waveform you can tap or drag to move through the track. It fits its bars to its own
 * width, so the whole track is always on show and a tap lands where it looks like it will.
 */
export function SeekTrack({
  peaks,
  height,
  progress,
  onSeek,
  played = C.accent,
  rest = C.waveDim,
  label = 'Position in track',
  duration,
  disabled,
  style,
}: {
  peaks: number[];
  height: number;
  /** How far through the track playback is, 0–1. */
  progress: number;
  /** Called with where to jump to, 0–1. */
  onSeek: (fraction: number) => void;
  played?: string;
  rest?: string;
  label?: string;
  /** The length of the track in seconds, so the position is read out as a time. */
  duration?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const box = useRef({ left: 0, width: 1 });
  const dragging = useRef<number | null>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);

  const at = (pageX: number) => Math.max(0, Math.min(1, (pageX - box.current.left) / box.current.width));
  const move = (pageX: number) => {
    dragging.current = at(pageX);
    setDrag(dragging.current);
  };
  const shown = Math.max(0, Math.min(1, drag ?? progress));
  const count = Math.max(8, Math.floor((width + 2) / 5));
  const bars = width > 0 ? waveBars(peaks, count, height, (i) => ((i + 0.5) / count <= shown ? played : rest)) : [];

  // Read out as a time when the length is known: "0:42 of 3:10".
  const spoken = duration && duration > 0 ? positionText(shown * duration, duration) : percentText(shown);
  const web =
    Platform.OS === 'web'
      ? {
          tabIndex: disabled ? -1 : 0,
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': Math.round(shown * 100),
          'aria-valuetext': spoken,
          onKeyDown: (e: { key: string; preventDefault: () => void }) => {
            if (disabled) return;
            if (e.key === 'ArrowRight') (e.preventDefault(), onSeek(stepFraction(progress, 1)));
            if (e.key === 'ArrowLeft') (e.preventDefault(), onSeek(stepFraction(progress, -1)));
          },
        }
      : {};

  return (
    <View
      ref={ref}
      {...(web as object)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100), text: spoken }}
      accessibilityState={{ disabled: !!disabled }}
      // A flick up or down with VoiceOver moves a twentieth of the track.
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const dir = actionDir(e.nativeEvent.actionName);
        if (dir && !disabled) onSeek(stepFraction(progress, dir));
      }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        const pageX = e.nativeEvent.pageX;
        // Measure on every touch: the screen may have scrolled or resized since the last one.
        ref.current?.measureInWindow((x, _y, w) => {
          if (w > 0) box.current = { left: x, width: w };
          move(pageX);
        });
      }}
      onResponderMove={(e) => dragging.current !== null && move(e.nativeEvent.pageX)}
      onResponderRelease={() => {
        if (dragging.current !== null) onSeek(dragging.current);
        dragging.current = null;
        setDrag(null);
      }}
      onResponderTerminate={() => {
        dragging.current = null;
        setDrag(null);
      }}
      style={[{ height, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' }, Platform.OS === 'web' && !disabled ? ({ cursor: 'pointer', touchAction: 'pan-y', userSelect: 'none' } as ViewStyle) : null, style]}
    >
      {bars.map((b, i) => (
        <View key={i} style={{ width: 3, height: Math.max(2, Math.min(height, b.h)), borderRadius: 2, backgroundColor: b.c, pointerEvents: 'none' }} />
      ))}
    </View>
  );
}

/** Turns normalised 0–1 peaks into bars of a given count, resampling as needed. */
export function waveBars(peaks: number[], count: number, maxHeight: number, color?: (i: number) => string | undefined): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    let p = 0;
    if (peaks.length > 0) {
      const from = Math.floor((i * peaks.length) / count);
      const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / count));
      for (let j = from; j < to && j < peaks.length; j++) p = Math.max(p, peaks[j]);
    }
    bars.push({ h: Math.round(6 + Math.sqrt(p) * (maxHeight - 6)), c: color?.(i) });
  }
  return bars;
}

export function Meter({ label, pct, height = 6, accent }: { label?: string; pct: number; height?: number; accent?: boolean }) {
  return (
    <View style={[s.row, { gap: 10 }]}>
      {label ? (
        <Txt size={12} color={C.muted} style={{ width: 10 }}>
          {label}
        </Txt>
      ) : null}
      <View style={{ flex: 1, height, borderRadius: 99, backgroundColor: C.line, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height, borderRadius: 99, backgroundColor: accent ? C.accent : C.text }} />
      </View>
    </View>
  );
}

// ---------- Motion ----------

/**
 * A dot that breathes while something is live, such as recording. It holds still for anyone who
 * has asked the system for less motion.
 */
export function Pulse({ size = 10, color, on = true }: { size?: number; color: string; on?: boolean }) {
  const glow = useRef(new Animated.Value(1)).current;
  const still = useReduceMotion();
  useEffect(() => {
    if (!on || still) return void glow.setValue(1);
    const step = (toValue: number) => Animated.timing(glow, { toValue, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE });
    const loop = Animated.loop(Animated.sequence([step(0.35), step(1)]));
    loop.start();
    return () => loop.stop();
  }, [on, still, glow]);
  return <Animated.View accessible={false} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: glow }} />;
}

// ---------- Slider ----------

/** How far a finger travels, in points, before a touch counts as a drag or a scroll. */
const SLOP = 6;

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onCommit,
  reset,
  detents,
  text,
  flick,
  height = 40,
  label,
  display,
  disabled,
  style,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** The value as words, such as "−3 dB". While the slider is dragged it shows in a bubble above the thumb, which the finger hides. */
  display?: string;
  onChange: (v: number) => void;
  /** Called once when the drag ends, for work too heavy to run on every move. */
  onCommit?: (v: number) => void;
  /** Where a double tap puts the slider back to, for controls with a natural rest such as 0 dB. */
  reset?: number;
  /** Values that are felt as the thumb arrives at them. The resting point is one already. */
  detents?: readonly number[];
  /** The value as it is read aloud, in its own units: "−3.5 dB", "0:42 of 3:10". */
  text?: string;
  /** How far one flick of VoiceOver, or one arrow key, moves it, when a single step is too small to be useful. */
  flick?: number;
  height?: number;
  label?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const box = useRef({ left: 0, width: 1 });
  const lastTap = useRef(0);
  // A light tap as the thumb reaches the centre or the resting point: once on arriving, not on every move.
  const stops = detents ?? (reset !== undefined ? [reset] : []);
  const move = (next: number) => {
    if (stops.length && reachedDetent(latest.current, next, stops)) tick();
    latest.current = next;
    onChange(next);
  };
  const latest = useRef(value);
  latest.current = value;
  // The touch in progress: where it began, the value then, and whether it has turned out to be a drag or a scroll.
  const touch = useRef<{ x: number; y: number; mode: 'wait' | 'drag' | 'scroll'; from: number; lastX: number } | null>(null);
  // Where the slider is in the window while it is being dragged, which is also when its bubble shows.
  const [held, setHeld] = useState<{ left: number; top: number; width: number } | null>(null);
  const [bubbleWidth, setBubbleWidth] = useState(52);
  const win = useWindowDimensions();

  const snap = (v: number) => {
    const stepped = Math.round((v - min) / step) * step + min;
    return Math.max(min, Math.min(max, Number(stepped.toFixed(6))));
  };
  const setFromPage = (pageX: number) => {
    const t = Math.max(0, Math.min(1, (pageX - box.current.left) / box.current.width));
    const next = snap(min + t * (max - min));
    if (next !== latest.current) move(next);
  };
  const measure = (then?: () => void) =>
    ref.current?.measureInWindow((x, _y, width) => {
      if (width > 0) box.current = { left: x + 9, width: Math.max(1, width - 18) };
      then?.();
    });
  const nudge = (dir: number, big?: boolean) => {
    const next = snap(latest.current + dir * (flick ?? step) * (big ? 10 : 1));
    move(next);
    onCommit?.(next);
  };

  const t = max > min ? (value - min) / (max - min) : 0;
  const web =
    Platform.OS === 'web'
      ? {
          tabIndex: disabled ? -1 : 0,
          'aria-valuemin': min,
          'aria-valuemax': max,
          'aria-valuenow': value,
          'aria-valuetext': text,
          onKeyDown: (e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
            if (disabled) return;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') (e.preventDefault(), nudge(1, e.shiftKey));
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') (e.preventDefault(), nudge(-1, e.shiftKey));
          },
        }
      : {};

  return (
    <View
      ref={ref}
      {...(web as object)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      // VoiceOver reads `text` when it is given, so a level is heard as "−3.5 dB", not as a bare number.
      accessibilityValue={text === undefined ? { min, max, now: value } : { min, max, now: value, text }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const dir = actionDir(e.nativeEvent.actionName);
        if (dir && !disabled) nudge(dir);
      }}
      onLayout={() => measure()}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      // Until the finger has clearly gone sideways the page may take the touch back to scroll.
      onResponderTerminationRequest={() => touch.current?.mode !== 'drag'}
      onResponderGrant={(e) => {
        touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, mode: 'wait', from: latest.current, lastX: e.nativeEvent.pageX };
        measure();
      }}
      onResponderMove={(e) => {
        const g = touch.current;
        if (!g || g.mode === 'scroll') return;
        const dx = Math.abs(e.nativeEvent.pageX - g.x);
        const dy = Math.abs(e.nativeEvent.pageY - g.y);
        // Nothing changes on touch-down: a finger passing over on its way up or down the page is
        // scrolling, and only one that sets off sideways is moving the slider.
        if (g.mode === 'wait') {
          if (dy > SLOP && dy > dx) g.mode = 'scroll';
          else if (dx > SLOP) {
            g.mode = 'drag';
            ref.current?.measureInWindow((x, y, width) => width > 0 && setHeld({ left: x, top: y, width }));
          }
        }
        if (g.mode === 'drag') {
          // Sliding the finger away from the track, up or down, slows the thumb for fine settings,
          // the way scrubbing does in the system's own players.
          const fine = dy > 120 ? 0.25 : dy > 50 ? 0.5 : 1;
          if (fine === 1) setFromPage(e.nativeEvent.pageX);
          else {
            const next = snap(latest.current + ((e.nativeEvent.pageX - g.lastX) / box.current.width) * (max - min) * fine);
            if (next !== latest.current) {
              move(next);
              g.lastX = e.nativeEvent.pageX;
            }
          }
          if (fine === 1) g.lastX = e.nativeEvent.pageX;
        }
      }}
      onResponderRelease={() => {
        const g = touch.current;
        touch.current = null;
        setHeld(null);
        // A tap that never moved sets the value where it landed; a second tap straight after puts it back to rest.
        if (g?.mode === 'wait') {
          const now = Date.now();
          if (reset !== undefined && now - lastTap.current < 320) {
            latest.current = snap(reset);
            tick();
            onChange(latest.current);
          } else setFromPage(g.x);
          lastTap.current = now;
        }
        if (g && g.mode !== 'scroll' && latest.current !== g.from) onCommit?.(latest.current);
      }}
      onResponderTerminate={() => {
        const g = touch.current;
        touch.current = null;
        setHeld(null);
        if (g && latest.current !== g.from) onCommit?.(latest.current);
      }}
      style={[{ height, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }, Platform.OS === 'web' && ({ cursor: 'pointer', userSelect: 'none', touchAction: 'pan-y' } as object), held && { zIndex: 10 }, style]}
    >
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: C.dim, marginHorizontal: 9 }}>
        <View style={{ width: `${t * 100}%`, height: 4, borderRadius: 2, backgroundColor: C.accent }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 18, top: 0, bottom: 0, justifyContent: 'center' }}>
        <View style={{ marginLeft: `${t * 100}%`, width: 18, height: 18, borderRadius: 9, backgroundColor: C.accent }} />
      </View>
      {held && display !== undefined && <Bubble text={display} at={9 + t * (held.width - 18)} width={bubbleWidth} onWidth={setBubbleWidth} held={held} height={height} windowWidth={win.width} />}
    </View>
  );
}

/** The value of a slider being dragged, shown clear of the finger. It takes no touches, so it never gets in the way of the drag or of scrolling. */
function Bubble({ text, at, width, onWidth, held, height, windowWidth }: { text: string; at: number; width: number; onWidth: (w: number) => void; held: { left: number; top: number; width: number }; height: number; windowWidth: number }) {
  const place = bubblePlace(at, width, held, height, windowWidth);
  return (
    <View
      testID="slider-bubble"
      pointerEvents="none"
      accessible={false}
      onLayout={(e) => Math.abs(e.nativeEvent.layout.width - width) > 0.5 && onWidth(e.nativeEvent.layout.width)}
      style={{ position: 'absolute', left: place.left, top: place.top, height: BUBBLE_HEIGHT, minWidth: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.45)' }}
    >
      <Txt size={14} w="semi" color={C.bg} numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
        {text}
      </Txt>
    </View>
  );
}

export function SliderRow({
  label,
  value,
  display,
  onChange,
  onCommit,
  reset,
  min = 0,
  max = 100,
  step = 1,
  labelWidth = 76,
  valueWidth = 62,
  minHeight = 40,
  fontSize = 14,
}: {
  label: string;
  value: number;
  display?: string;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  reset?: number;
  min?: number;
  max?: number;
  step?: number;
  labelWidth?: number;
  valueWidth?: number;
  minHeight?: number;
  fontSize?: number;
}) {
  const scale = useTextScale();
  // At the largest text sizes the label and the value no longer fit beside the track: they go
  // above it on a line of their own, and the track gets the full width.
  if (useLargeText())
    return (
      <View style={{ paddingTop: 6 }}>
        <View style={[s.row, s.between]}>
          <Txt size={fontSize} style={{ flexShrink: 1 }}>
            {label}
          </Txt>
          {display !== undefined && (
            <Txt size={13} color={C.muted} right>
              {display}
            </Txt>
          )}
        </View>
        <Slider label={label} text={display} value={value} min={min} max={max} step={step} display={display} onChange={onChange} onCommit={onCommit} reset={reset} height={minHeight} />
      </View>
    );
  return (
    <View style={[s.row, { minHeight }]}>
      <Txt size={fontSize} style={{ width: Math.round(labelWidth * scale) }}>
        {label}
      </Txt>
      <Slider label={label} text={display} value={value} min={min} max={max} step={step} display={display} onChange={onChange} onCommit={onCommit} reset={reset} height={minHeight} style={{ flex: 1 }} />
      {display !== undefined && (
        <Txt size={13} color={C.muted} right style={{ width: Math.round(valueWidth * scale) }}>
          {display}
        </Txt>
      )}
    </View>
  );
}

// ---------- Checkbox, radio, option rows ----------

export function Check({ checked, round, size = 22 }: { checked: boolean; round?: boolean; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: round ? size / 2 : 5,
        borderWidth: checked && !round ? 0 : 1.5,
        borderColor: checked ? C.accent : C.muted,
        backgroundColor: checked && !round ? C.accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked && round && <View style={{ width: size - 10, height: size - 10, borderRadius: size, backgroundColor: C.accent }} />}
      {checked && !round && (
        <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
          <Path d="M2 7.5l3.2 3L12 3.5" stroke={C.bg} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )}
    </View>
  );
}

/** A tappable row with a checkbox or radio, a label and an optional hint. */
export function Option({
  label,
  sub,
  hint,
  checked,
  onChange,
  radio,
  divided,
  minHeight = 48,
  boxFirst,
  w = 'medium',
}: {
  label: string;
  sub?: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  radio?: boolean;
  divided?: boolean;
  minHeight?: number;
  boxFirst?: boolean;
  w?: Weight;
}) {
  const box = <Check checked={checked} round={radio} size={radio ? 20 : 22} />;
  // With large text the hint goes under the label instead of squeezing it from the right.
  const large = useLargeText();
  return (
    <Pressable
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(radio ? true : !checked)}
      style={[s.row, { minHeight, gap: boxFirst ? 12 : 14 }, large && { paddingVertical: 8 }, divided && s.divided]}
    >
      {boxFirst && box}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size={15} w={sub ? 'semi' : w}>
          {label}
        </Txt>
        {sub ? <Txt size={13} color={C.muted}>{sub}</Txt> : null}
        {hint && large ? <Txt size={13} color={C.muted}>{hint}</Txt> : null}
      </View>
      {hint && !large ? (
        <Txt size={13} color={C.muted}>
          {hint}
        </Txt>
      ) : null}
      {!boxFirst && box}
    </Pressable>
  );
}

export function Disclosure({ title, summary, open, onToggle, last, children, size = 16 }: { title: string; summary: string; open: boolean; onToggle: () => void; last?: boolean; children?: ReactNode; size?: number }) {
  // With large text the summary goes under the title, in full, instead of being cut short beside it.
  const large = useLargeText();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={[s.row, { minHeight: 48, justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.line }, large && { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 2, paddingVertical: 10 }, last && !open && s.divided]}
      >
        <Txt size={size} w="semi">
          {title}
        </Txt>
        <Txt size={13} color={C.muted} numberOfLines={large ? undefined : 1} style={{ flexShrink: 1 }}>
          {summary}
        </Txt>
      </Pressable>
      <Collapse open={open}>{children}</Collapse>
    </>
  );
}

// ---------- Fields ----------

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  const drawn = useDrawScale();
  return (
    <TextInput
      maxFontSizeMultiplier={MAX_TEXT_SCALE}
      accessibilityLabel={label}
      placeholderTextColor={C.muted}
      selectionColor={C.accent}
      {...rest}
      style={[s.field, drawn !== 1 && { fontSize: 16 * drawn }, Platform.OS === 'web' && ({ outlineColor: C.accent } as object), style]}
    />
  );
}

// ---------- Icons ----------

export function PlayIcon({ size = 16, color = C.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Path d="M5 3l10 6-10 6z" fill={color} />
    </Svg>
  );
}

export function PauseIcon({ size = 26, color = C.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Rect x={4} y={3} width={4} height={14} rx={1} fill={color} />
      <Rect x={12} y={3} width={4} height={14} rx={1} fill={color} />
    </Svg>
  );
}

export function MicIcon({ size = 26, color = C.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26" fill="none">
      <Rect x={9} y={3} width={8} height={13} rx={4} stroke={color} strokeWidth={2} />
      <Path d="M5 12a8 8 0 0016 0M13 20v3" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function TickIcon({ size = 14, color = C.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path d="M2 7.5l3.2 3L12 3.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function SkipIcon({ size = 26, color = C.text, back }: { size?: number; color?: string; back?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      {back ? (
        <>
          <Path d="M22 4v18L9 13z" fill={color} />
          <Rect x={4} y={4} width={3} height={18} rx={1} fill={color} />
        </>
      ) : (
        <>
          <Path d="M4 4v18l13-9z" fill={color} />
          <Rect x={19} y={4} width={3} height={18} rx={1} fill={color} />
        </>
      )}
    </Svg>
  );
}

/** The record/stop control: a ring with a red square (stop) or red disc (record). */
export function StopButton({ size = 96, recording = true, live, onPress, halo, label, disabled }: { size?: number; recording?: boolean; /** Sound is being recorded right now: a ring spreads from the button. */ live?: boolean; onPress?: () => void; halo?: boolean; label: string; disabled?: boolean }) {
  const inner = Math.round(size * 0.35);
  const disc = inner * 1.5;
  // The red disc shrinks into the stop square, and back, instead of swapping.
  const at = useGlide(recording);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ opacity: disabled ? 0.35 : pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <View style={[halo && { padding: 10, borderRadius: size, backgroundColor: C.recHalo }]}>
        <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: size > 110 ? 4 : 3, borderColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
          <Halo on={!!live && !disabled} size={size} color={C.rec} />
          <Animated.View style={{ position: 'absolute', width: disc, height: disc, borderRadius: disc / 2, backgroundColor: C.rec, opacity: at.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ scale: at.interpolate({ inputRange: [0, 1], outputRange: [1, inner / disc] }) }] }} />
          <Animated.View style={{ width: inner, height: inner, borderRadius: Math.round(inner * 0.23), backgroundColor: C.rec, opacity: at, transform: [{ scale: at.interpolate({ inputRange: [0, 1], outputRange: [disc / inner, 1] }) }] }} />
        </View>
      </View>
    </Pressable>
  );
}

// ---------- Shared styles ----------

export const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { justifyContent: 'space-between' },
  divided: { borderBottomWidth: 1, borderBottomColor: C.line },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, gap: 12 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 20, padding: 20, gap: 14 },
  btn: { alignItems: 'center', justifyContent: 'center', borderRadius: 16, minHeight: 56, paddingHorizontal: 16 },
  segmented: { flexDirection: 'row', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 44, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: C.borderStrong, alignItems: 'center', justifyContent: 'center' },
  field: { minHeight: 48, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 16, color: C.text, fontFamily: F.regular, fontSize: 16 },
});
