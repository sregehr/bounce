// Larger building blocks shared by several screens.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, View } from 'react-native';
import { TAPS } from '@/dsp/latency';
import { startClapCheck } from '@/engine/engine';
import type { ClapRun, EngineState } from '@/engine/types';

import { pastThreshold } from './feel';
import { tick } from './haptics';
import { useArmed } from './hooks';
import { Check, Meter, Muted, NavLink, RoundPlay as RoundPlayLazy, Slider as SliderLazy, TickIcon, Txt, s } from './kit';
import { C, meterPct, rateLabel } from './theme';

export function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 4 }}>
      <Txt size={12} color={alert ? C.recText : C.muted}>
        {label}
      </Txt>
      <Txt size={20} w="displayMedium">
        {value}
      </Txt>
    </View>
  );
}

/** A closed row showing the current choice that opens into a list. */
export function Picker<T extends string>({ label, value, options, onChange, fallback = 'Choose' }: { label: string; value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; fallback?: string }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <Txt size={12} color={C.muted}>
        {label}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? 'none'}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={[s.row, s.between, { minHeight: 48, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 16 }]}
      >
        <Txt size={16} numberOfLines={1} style={{ flexShrink: 1 }}>
          {current?.label ?? fallback}
        </Txt>
        <Txt size={13} color={C.muted}>
          {open ? 'Close' : 'Change'}
        </Txt>
      </Pressable>
      {open &&
        options.map((o) => (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: o.value === value }}
            onPress={() => {
              setOpen(false);
              if (o.value !== value) onChange(o.value);
            }}
            style={[s.row, { minHeight: 44, paddingHorizontal: 4 }]}
          >
            <Check checked={o.value === value} round size={20} />
            <Txt size={15} style={{ flex: 1 }} numberOfLines={1}>
              {o.label}
            </Txt>
          </Pressable>
        ))}
    </View>
  );
}

export function pairLabel(input: EngineState['input']) {
  if (input.channels <= 1) return 'mono';
  if (input.channels === 2) return 'stereo';
  return `inputs ${input.pair * 2 + 1}–${input.pair * 2 + 2} of ${input.channels}`;
}

/** Name, format, live meters and input choice for the connected input. */
export function InputPanel({ input, onPick, onPair }: { input: EngineState['input']; onPick: (deviceId: string) => void; onPair: (pair: number) => void }) {
  const pairs = Math.floor(input.channels / 2);
  return (
    <>
      <Txt size={30} w="display" numberOfLines={2}>
        {input.label}
      </Txt>
      <Txt size={14} color={C.muted}>
        {rateLabel(input.sampleRate)} · {pairLabel(input)}
      </Txt>
      <View style={{ gap: 6 }}>
        <Meter label="L" pct={meterPct(input.levelL)} />
        <Meter label="R" pct={meterPct(input.levelR)} />
      </View>
      {pairs > 1 && (
        <View style={[s.row, s.between]}>
          <NavLink size={14} onPress={() => onPair((input.pair - 1 + pairs) % pairs)}>
            Previous pair
          </NavLink>
          <NavLink size={14} onPress={() => onPair((input.pair + 1) % pairs)}>
            Next pair
          </NavLink>
        </View>
      )}
      {input.inputs.length > 1 && <Picker label="Input" value={input.deviceId} options={input.inputs.map((d) => ({ value: d.deviceId, label: d.label }))} onChange={onPick} fallback={input.label} />}
    </>
  );
}

/** Play button, a seek bar and the time, for screens where the song plays while you adjust it. */
export function MiniTransport({ playing, position, duration, onToggle, onSeek, busy }: { playing: boolean; position: number; duration: number; onToggle: () => void; onSeek: (seconds: number) => void; busy?: boolean }) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? position;
  const mm = (v: number) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
  return (
    <View style={[s.row, { gap: 12 }]}>
      <RoundPlayLazy playing={playing} onPress={onToggle} disabled={duration <= 0} />
      <View style={{ flex: 1 }}>
        <SliderLazy
          label="Position in track"
          value={Math.min(shown, duration)}
          min={0}
          max={Math.max(1, duration)}
          step={0.1}
          height={32}
          disabled={duration <= 0}
          onChange={setDrag}
          onCommit={(v) => {
            setDrag(null);
            onSeek(v);
          }}
        />
      </View>
      <Txt size={13} color={C.muted} right style={{ width: 82, fontVariant: ['tabular-nums'] }}>
        {busy ? 'Updating…' : `${mm(shown)} / ${mm(duration)}`}
      </Txt>
    </View>
  );
}

export type ClapOutcome = { ms: number | null; matched: number; clicks: number };

/**
 * The timing check for earbuds, where the mic cannot hear the clicks: a pulse plays and the artist claps along.
 * The mic hears the claps, so the result covers both the delay to the ears and the mic's own delay.
 */
export function ClapCheck({ input, onDone, onCancel }: { input: EngineState['input']; onDone: (outcome: ClapOutcome) => void; onCancel: () => void }) {
  const [click, setClick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let over = false;
    let run: ClapRun | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    startClapCheck()
      .then((r) => {
        if (over) return r.stop();
        run = r;
        tick = setInterval(() => setClick(r.clicksAt.filter((t) => t <= performance.now()).length), 100);
        void r.result.then((result) => !over && done.current({ ms: result.medianMs === null ? null : Math.round(result.medianMs), matched: result.matched, clicks: result.clicks }));
      })
      .catch((e) => !over && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      over = true;
      if (tick) clearInterval(tick);
      run?.stop();
    };
  }, []);

  const level = Math.min(1, meterPct(Math.max(input.levelL, input.levelR)) / 100);
  return (
    <View style={{ gap: 14, alignItems: 'center' }}>
      <Muted center>{error ?? 'Keep your earbuds in. Clap on every click, or say “ta”, right on the beat like you would rap it.'}</Muted>
      <View accessibilityLabel="Listening for your claps" style={{ width: 148, height: 148, borderRadius: 74, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.accent }}>
        {/* The disc swells with the mic, so a clap that registers can be seen. */}
        <View style={{ position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: C.accent, opacity: 0.85 * level, transform: [{ scale: 0.55 + 0.45 * level }] }} />
        <Txt size={26} w="display" color={C.text}>
          Clap
        </Txt>
      </View>
      <Txt size={13} color={C.muted}>
        {click === 0 ? 'Get ready…' : `Click ${Math.min(click, TAPS.count)} of ${TAPS.count}`}
      </Txt>
      <NavLink center size={14} onPress={onCancel}>
        Cancel
      </NavLink>
    </View>
  );
}

const TONES = { plain: C.muted, good: C.text, todo: C.accent, bad: C.recText } as const;

/** A small pill that states one fact about the song. With `onPress` it also opens more detail. */
export function Status({ label, tone = 'plain', onPress, expanded, hint }: { label: string; tone?: keyof typeof TONES; onPress?: () => void; expanded?: boolean; hint?: string }) {
  const color = TONES[tone];
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityState={onPress ? { expanded: !!expanded } : undefined}
      disabled={!onPress}
      onPress={onPress}
      hitSlop={6}
      style={{ minHeight: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: tone === 'todo' || tone === 'bad' ? color : C.borderStrong, flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      {tone === 'good' && <TickIcon />}
      <Txt size={12} w="semi" color={color}>
        {label}
        {onPress ? (expanded ? '  ▴' : '  ▾') : ''}
      </Txt>
    </Pressable>
  );
}

const DELETE_WIDTH = 92;
// In a browser, dragging with a mouse would otherwise start selecting the row's text, which ends the swipe.
const NO_SELECT = { userSelect: 'none' } as object;

/**
 * A list row that slides left to show a Delete button, as iOS lists do. The swipe only shows
 * the button, and deleting takes two taps on it: the first asks, the second deletes. Swiping
 * back, tapping the row, or waiting a few seconds puts it away again.
 */
export function SwipeRow({ children, label, onDelete }: { children: ReactNode; label: string; onDelete: () => void }) {
  const x = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const from = useRef(0);
  // A mouse drag ends with a click on whatever was pressed, which is the row itself. While dragging,
  // the row's content takes no pointer events, so that click lands on the wrapper and opens nothing.
  const [dragging, setDragging] = useState(false);
  const [sure, askSure, notSure] = useArmed(4000);
  // Whether the drag in progress is past the point where letting go shows Delete. Crossing it is
  // felt, once each way, so the finger knows before it lifts.
  const past = useRef(false);
  const settle = (show: boolean) => {
    if (!show) notSure();
    setOpen(show);
    from.current = show ? -DELETE_WIDTH : 0;
    Animated.spring(x, { toValue: from.current, useNativeDriver: false, bounciness: 0, speed: 20 }).start();
  };
  const pan = useRef(
    PanResponder.create({
      // Only a sideways drag is taken, so the page still scrolls and a tap still reaches the row.
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        past.current = from.current < 0;
        setDragging(true);
      },
      onPanResponderMove: (_, g) => {
        const now = pastThreshold(past.current, from.current + g.dx, -DELETE_WIDTH / 2);
        if (now !== past.current) tick();
        past.current = now;
        x.setValue(Math.max(-DELETE_WIDTH - 24, Math.min(0, from.current + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        settle(pastThreshold(past.current, from.current + g.dx, -DELETE_WIDTH / 2));
        setTimeout(() => setDragging(false), 80);
      },
      onPanResponderTerminate: () => {
        settle(false);
        setDragging(false);
      },
    }),
  ).current;
  return (
    <View style={{ overflow: 'hidden' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sure ? `Tap again to ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'yes' : 'no-hide-descendants'}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        disabled={!open}
        onPress={() => {
          if (!sure) return askSure();
          settle(false);
          onDelete();
        }}
        style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: DELETE_WIDTH, backgroundColor: C.rec, alignItems: 'center', justifyContent: 'center', opacity: open ? 1 : 0 }}
      >
        <Txt size={sure ? 13 : 14} w="semi" color={C.text} center>
          {sure ? 'Tap again' : 'Delete'}
        </Txt>
      </Pressable>
      <Animated.View {...pan.panHandlers} style={[{ backgroundColor: C.bg, transform: [{ translateX: x }] }, NO_SELECT]}>
        {/* While the button is showing, a tap on the row closes it instead of opening the row. */}
        <View pointerEvents={open || dragging ? 'none' : 'auto'}>{children}</View>
        {open && <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => settle(false)} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />}
      </Animated.View>
    </View>
  );
}
