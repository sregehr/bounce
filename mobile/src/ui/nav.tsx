// How screens that are not tabs come and go: sheets that rise over the screen you were on, and
// the one control in the top-left corner that leaves any of them.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { Animated, Easing, PanResponder, Platform, Pressable, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { router, useIsFocused, useLocalSearchParams, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { NATIVE, useReduceMotion } from './motion';
import { C } from './theme';
import { Narrow } from './wide';

/**
 * The task screens that are presented as sheets rather than pushed: you step out of what you
 * were doing, finish the task, and the sheet goes away to show the screen underneath again.
 * The setup walk-through joins them when it is opened from the mic screen (`/onboarding?setup=1`).
 */
export const SHEETS = ['/player', '/cover', '/export', '/snippet', '/demos'];

type Sheet = {
  /** Closes the sheet: back to the screen underneath. */
  close: () => void;
};

const SheetContext = createContext<Sheet | null>(null);

/** The sheet this screen is presented in, or null on a pushed screen or a tab. */
export const useSheet = () => useContext(SheetContext);

/** Back to the screen underneath, or to `fallback` when the app was opened straight onto this one. */
function leave(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

type SheetOptions = {
  /** Where closing leads when there is nothing underneath, as after a reload in the browser. */
  fallback?: Href;
  /** Replaces going back, for a screen that always closes to the same place. */
  onClose?: () => void;
  /** Only a sheet when this says so, for a screen that is also shown full screen. */
  when?: (params: Record<string, string | string[] | undefined>) => boolean;
  /** `anywhere` lets a downward drag from any part of the sheet close it, for a screen that does not scroll. */
  swipe?: 'handle' | 'anywhere';
  /** On the phone this one covers the whole screen (see `_layout`), so it keeps the layout for the screen's real size. */
  cover?: boolean;
};

/**
 * Presents a screen as a sheet. On the phone the system does it (see the Stack options in
 * `_layout`): it rises from the bottom and is swiped down to close. A browser has no sheets, so
 * there this draws one: a dimmed backdrop that closes it on a tap, a card with a grabber that can
 * be dragged down, and Escape. A phone-sized window gets a card nearly the full height; a tablet
 * or desktop window gets one floating in the middle.
 */
export function asSheet<P extends object>(Inner: ComponentType<P>, { fallback = '/', onClose, when, swipe = 'handle', cover }: SheetOptions = {}) {
  function Presented(props: P) {
    const params = useLocalSearchParams();
    const on = when ? when(params) : true;
    const close = useCallback(() => (onClose ? onClose() : leave(fallback)), []);
    const sheet = useMemo(() => ({ close }), [close]);
    if (!on) return <Inner {...props} />;
    if (Platform.OS !== 'web')
      return (
        <SheetContext.Provider value={sheet}>
          <Narrow.Provider value={!cover}>
            <Inner {...props} />
          </Narrow.Provider>
        </SheetContext.Provider>
      );
    return (
      <WebSheet close={close} swipe={swipe}>
        <Inner {...props} />
      </WebSheet>
    );
  }
  Presented.displayName = `Sheet(${Inner.displayName ?? Inner.name})`;
  return Presented;
}

/** How far down a sheet is dragged, in points, before letting go closes it. */
const DISMISS_AFTER = 120;

function WebSheet({ children, close, swipe }: { children: React.ReactNode; close: () => void; swipe: 'handle' | 'anywhere' }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const still = useReduceMotion();
  const focused = useIsFocused();
  // 0 is away, 1 is in place; `drag` is how far a finger has pulled it down.
  const shown = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const leaving = useRef(false);

  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: still ? 120 : 320, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    Animated.timing(shown, { toValue: 0, duration: still ? 100 : 220, easing: Easing.in(Easing.cubic), useNativeDriver: NATIVE }).start(() => {
      close();
      // If something kept the screen open, it can be closed again.
      leaving.current = false;
    });
  }, [close, shown, still]);
  const latest = useRef(dismiss);
  latest.current = dismiss;

  // Escape closes the sheet on top, as it does a dialog anywhere else in a browser.
  useEffect(() => {
    if (!focused || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Escape in a field only leaves the field.
      const at = document.activeElement;
      if (at instanceof HTMLElement && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA')) return at.blur();
      latest.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focused]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => swipe === 'handle',
      // Only a drag that sets off downwards is taken, so sliders and taps inside the sheet still work.
      onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && g.dy > Math.abs(g.dx) * 2,
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_AFTER || g.vy > 0.9) return latest.current();
        Animated.spring(drag, { toValue: 0, useNativeDriver: NATIVE, bounciness: 0, speed: 20 }).start();
      },
      onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: NATIVE, bounciness: 0, speed: 20 }).start(),
    }),
  ).current;

  // A phone-sized window: nearly full height, square at the bottom. Anything bigger: a card with room around it.
  const wide = width >= 1000 && width > height;
  const phone = !wide && width < 600;
  const frame: ViewStyle = phone
    ? { left: 0, right: 0, top: insets.top + 10, bottom: 0, borderTopLeftRadius: 18, borderTopRightRadius: 18 }
    : wide
      ? { left: 40, right: 40, top: 28, bottom: 28, borderRadius: 24 }
      : { left: Math.max(24, (width - 720) / 2), right: Math.max(24, (width - 720) / 2), top: 44, bottom: 44, borderRadius: 22 };
  // With less motion asked for, the sheet fades in where it stands instead of travelling.
  const rise = still ? 0 : shown.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });
  const sheet = useMemo(() => ({ close: dismiss }), [dismiss]);

  return (
    <SheetContext.Provider value={sheet}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <Animated.View aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', opacity: shown }}>
          <Pressable onPress={dismiss} tabIndex={-1} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View
          role="dialog"
          aria-modal
          {...(swipe === 'anywhere' ? pan.panHandlers : null)}
          style={[{ position: 'absolute', overflow: 'hidden', backgroundColor: C.bg, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.16)', boxShadow: '0 -8px 40px rgba(0,0,0,0.5)', opacity: still ? shown : 1, transform: [{ translateY: Animated.add(rise, drag) }] }, frame]}
        >
          {children}
          {/* The grabber: drag it down, or tap it, to close. It sits over the top of the content. */}
          <View {...(swipe === 'handle' ? pan.panHandlers : null)} style={[{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 22, alignItems: 'center', paddingTop: 7 }, { cursor: 'grab', touchAction: 'none' } as object]}>
            <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.32)' }} />
          </View>
        </Animated.View>
      </View>
    </SheetContext.Provider>
  );
}

/** The top padding a screen needs inside a sheet: clear of the grabber, with no status bar to avoid. */
export const SHEET_TOP = 22;

// ---------- The back control ----------

function Glyph({ close, color }: { close: boolean; color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path d={close ? 'M6 6l12 12M18 6L6 18' : 'M15 4.5 7.5 12l7.5 7.5'} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * The one way out of a screen that is not a tab, always in the top-left corner and always 44
 * points square: a chevron on a pushed screen (back to where you were), a cross on a sheet
 * (close it). `to` is where it leads when there is nothing to go back to; `onPress` runs first;
 * `onBack` replaces leaving altogether, for a step inside a screen.
 */
export function BackButton({ to = '/', onPress, onBack, label, disc, style }: { to?: Href; onPress?: () => void; onBack?: () => void; label?: string; /** Drawn on a dark disc, for sitting on top of a picture. */ disc?: boolean; style?: StyleProp<ViewStyle> }) {
  const sheet = useSheet();
  const close = !!sheet && !onBack;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? (close ? 'Close' : 'Back')}
      hitSlop={6}
      onPress={() => {
        onPress?.();
        if (onBack) onBack();
        else if (sheet) sheet.close();
        else leave(to);
      }}
      style={({ pressed }) => [
        { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.55 : 1 },
        // On a page the glyph lines up with the edge of the text below it; on a disc it sits in the middle.
        disc ? { backgroundColor: 'rgba(18,18,18,0.82)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.28)' } : { marginLeft: -10 },
        style,
      ]}
    >
      <Glyph close={close} color={C.text} />
    </Pressable>
  );
}
