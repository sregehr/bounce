// Larger building blocks shared by several screens.
import { useEffect, useRef, useState } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { analyseTaps, TAPS } from '@/dsp/latency';
import { startTapCheck } from '@/engine/engine';
import type { EngineState, TapRun } from '@/engine/types';

import { Check, Meter, Muted, NavLink, RoundPlay as RoundPlayLazy, Slider as SliderLazy, Txt, s } from './kit';
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

export type TapOutcome = { ms: number | null; matched: number; clicks: number };

/**
 * The timing check for earbuds, where the mic cannot hear the clicks: a pulse plays and the artist taps along.
 * How late the taps land is how late the sound reaches their ears; the input's own delay is added on top.
 */
export function TapCheck({ onDone, onCancel }: { onDone: (outcome: TapOutcome) => void; onCancel: () => void }) {
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<TapRun | null>(null);
  const taps = useRef<number[]>([]);
  const [lit, setLit] = useState(false);
  const flash = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let over = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    startTapCheck()
      .then((r) => {
        if (over) return r.stop();
        run.current = r;
        timer = setTimeout(() => {
          const result = analyseTaps(r.clicksAt, taps.current);
          done.current({ ms: result.medianMs === null ? null : Math.round(result.medianMs + r.inputMs), matched: result.matched, clicks: result.clicks });
        }, Math.max(0, r.endsAt - performance.now()));
      })
      .catch((e) => !over && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      over = true;
      if (timer) clearTimeout(timer);
      if (flash.current) clearTimeout(flash.current);
      run.current?.stop();
    };
  }, []);

  return (
    <View style={{ gap: 14, alignItems: 'center' }}>
      <Muted center>{error ?? 'Keep your earbuds in. Tap the circle on every click, like tapping along to a song.'}</Muted>
      {/* A bare pointer-down, not a Pressable: a press handler waits to tell taps from scrolls and drops the quickest ones. */}
      <View
        accessibilityRole="button"
        accessibilityLabel="Tap on each click"
        onPointerDown={(e) => {
          // The event carries when the finger landed, which is earlier and steadier than when this handler runs.
          const now = performance.now();
          const at = (e.nativeEvent as { timeStamp?: number }).timeStamp;
          taps.current.push(typeof at === 'number' && Math.abs(at - now) < 250 ? at : now);
          setCount(taps.current.length);
          setLit(true);
          if (flash.current) clearTimeout(flash.current);
          flash.current = setTimeout(() => setLit(false), 110);
        }}
        style={{
          width: 148,
          height: 148,
          borderRadius: 74,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: lit ? C.accent : 'transparent',
          borderWidth: 2,
          borderColor: C.accent,
          transform: [{ scale: lit ? 0.95 : 1 }],
          userSelect: 'none',
          cursor: 'pointer',
          // Stops the browser treating fast taps as a double-tap zoom or a scroll.
          touchAction: 'none',
        } as ViewStyle}
      >
        <Txt size={26} w="display" color={lit ? C.bg : C.accent}>
          Tap
        </Txt>
      </View>
      <Txt size={13} color={C.muted}>
        {Math.min(count, TAPS.count)} of {TAPS.count} taps
      </Txt>
      <NavLink center size={14} onPress={onCancel}>
        Cancel
      </NavLink>
    </View>
  );
}
