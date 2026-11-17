// Motion that respects the system's Reduce Motion setting. Everything that moves in the app
// asks here first, so one switch in Settings (or in the browser) stills all of it.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

let reduced = false;
let started = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === reduced) return;
  reduced = next;
  listeners.forEach((fn) => fn());
}

/** Starts listening to the system setting the first time anything asks. */
function start() {
  if (started) return;
  started = true;
  void AccessibilityInfo.isReduceMotionEnabled().then(set, () => {});
  AccessibilityInfo.addEventListener('reduceMotionChanged', set);
}

/** Whether the person has asked for less motion. For code outside a component; it is right once the app has drawn once. */
export function reduceMotion() {
  start();
  return reduced;
}

/** Whether the person has asked for less motion. Re-renders when they change it. */
export function useReduceMotion() {
  start();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => reduced,
    () => false,
  );
}

/** Transforms and opacity run off the JavaScript thread on the phone; the browser has no such driver. */
export const NATIVE = Platform.OS !== 'web';

// ---------- Pieces that move ----------

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/**
 * Content that opens and closes by growing and shrinking instead of snapping in and out. It is
 * measured once it is there, so anything can go inside. With less motion asked for it simply
 * appears and goes.
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const still = useReduceMotion();
  const at = useRef(new Animated.Value(open ? 1 : 0)).current;
  // Whether the content is in the tree, and whether it has finished opening (then it sizes itself again).
  const [mounted, setMounted] = useState(open);
  const [settled, setSettled] = useState(open);
  const [height, setHeight] = useState<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) return void (first.current = false);
    if (still) {
      at.setValue(open ? 1 : 0);
      setMounted(open);
      setSettled(open);
      return;
    }
    if (open) setMounted(true);
    setSettled(false);
    // Height is layout, which the phone's native driver cannot animate; it is one value on one view for a fifth of a second.
    const run = Animated.timing(at, { toValue: open ? 1 : 0, duration: 220, easing: EASE, useNativeDriver: false });
    run.start(({ finished }) => {
      if (!finished) return;
      if (open) setSettled(true);
      else setMounted(false);
    });
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, still]);

  if (!mounted && !open) return null;
  if (settled && open)
    return (
      <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>{children}</View>
    );
  return (
    <Animated.View style={{ overflow: 'hidden', opacity: at, height: height === null ? 0 : at.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) }}>
      {/* Out of the flow while it moves, so it keeps its full height to be measured and clipped. */}
      <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        {children}
      </View>
    </Animated.View>
  );
}

/**
 * A menu growing out of the control that opened it, rather than popping into place. `from` is
 * the corner it grows from. With less motion asked for it fades in where it stands.
 */
export function Pop({ children, from = 'top right', style }: { children: ReactNode; from?: 'top right' | 'top left' | 'bottom right' | 'bottom left' | 'bottom'; style?: StyleProp<ViewStyle> }) {
  const still = useReduceMotion();
  const at = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(at, { toValue: 1, duration: still ? 90 : 160, easing: EASE, useNativeDriver: NATIVE }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Animated.View style={[style, { opacity: at, transformOrigin: from, transform: still ? [] : [{ scale: at.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>{children}</Animated.View>;
}

/**
 * A value that glides between 0 and 1 as `on` changes, for cross-fading two states of a control
 * (the record button turning into the stop button). It runs on the native driver, so use it for
 * opacity and transforms only. With less motion asked for it switches at once.
 */
export function useGlide(on: boolean, duration = 180) {
  const still = useReduceMotion();
  const at = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    if (still) return void at.setValue(on ? 1 : 0);
    const run = Animated.timing(at, { toValue: on ? 1 : 0, duration, easing: EASE, useNativeDriver: NATIVE });
    run.start();
    return () => run.stop();
  }, [on, still, at, duration]);
  return at;
}

/**
 * A ring that spreads out from the record button and fades, over and over, while recording.
 * It sits behind the button it is placed in, which must be `size` across. With less motion
 * asked for there is no ring; the button's colour and shape already say it is recording.
 */
export function Halo({ on, size, color }: { on: boolean; size: number; color: string }) {
  const still = useReduceMotion();
  const at = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on || still) return void at.setValue(0);
    const loop = Animated.loop(Animated.timing(at, { toValue: 1, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }));
    loop.start();
    return () => loop.stop();
  }, [on, still, at]);
  if (!on || still) return null;
  return (
    <Animated.View
      accessible={false}
      pointerEvents="none"
      style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color, opacity: at.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.6, 0] }), transform: [{ scale: at.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] }}
    />
  );
}
