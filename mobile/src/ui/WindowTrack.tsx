import { useRef, useState, type ComponentRef } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';

import { waveBars } from './kit';
import { actionDir, percentText } from './spoken';
import { C } from './theme';

/**
 * A whole track as a waveform, with one stretch of it lit. Touching or dragging moves that
 * stretch, centred under the finger; `onMove` is told where it now starts (0–1) on letting go.
 * `snap` can pull a start onto a bar line, and is applied while dragging too.
 */
export function WindowTrack({ peaks, height, from, span, onMove, snap = (f) => f, label, say, disabled }: { peaks: number[]; height: number; from: number; span: number; onMove: (from: number) => void; snap?: (from: number) => number; label: string; /** Where the stretch is, as it is read aloud: "0:30 to 0:50". */ say?: (from: number) => string; disabled?: boolean }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const box = useRef({ left: 0, width: 1 });
  const dragging = useRef<number | null>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);

  const room = Math.max(0, 1 - span);
  const fit = (f: number) => Math.max(0, Math.min(room, snap(Math.max(0, Math.min(room, f)))));
  const move = (pageX: number) => {
    dragging.current = fit((pageX - box.current.left) / box.current.width - span / 2);
    setDrag(dragging.current);
  };
  const shown = fit(drag ?? from);
  const count = Math.max(8, Math.floor((width + 2) / 4));
  const lit = (i: number) => (i + 0.5) / count >= shown && (i + 0.5) / count <= shown + span;
  const bars = width > 0 ? waveBars(peaks, count, height - 8, (i) => (lit(i) ? C.accent : C.dim)) : [];

  const spoken = say ? say(shown) : `Starts ${percentText(shown)} of the way in`;
  // One arrow key, or one flick of VoiceOver, moves the stretch a quarter of its own length (and onto a bar line, where `snap` does that).
  const step = Math.max(0.01, span / 4);
  const nudge = (dir: 1 | -1) => {
    let next = fit(from + dir * step);
    // Snapping can pull a small step straight back; keep going until it lands somewhere new.
    for (let n = 2; next === fit(from) && n <= 8; n++) next = fit(from + dir * step * n);
    if (next !== fit(from)) onMove(next);
  };
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
            if (e.key === 'ArrowRight') (e.preventDefault(), nudge(1));
            if (e.key === 'ArrowLeft') (e.preventDefault(), nudge(-1));
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
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const dir = actionDir(e.nativeEvent.actionName);
        if (dir && !disabled) nudge(dir);
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
        if (dragging.current !== null) onMove(dragging.current);
        dragging.current = null;
        setDrag(null);
      }}
      onResponderTerminate={() => {
        dragging.current = null;
        setDrag(null);
      }}
      style={[{ height, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }, Platform.OS === 'web' && !disabled ? ({ cursor: 'pointer', touchAction: 'pan-y', userSelect: 'none' } as ViewStyle) : null]}
    >
      {/* The lit stretch sits in a frame, so it reads as something to move. */}
      {width > 0 && <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: shown * width, width: Math.max(8, span * width), borderRadius: 8, borderWidth: 1.5, borderColor: C.accent, backgroundColor: 'rgba(255,176,32,0.12)' }} />}
      <View pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {bars.map((b, i) => (
          <View key={i} style={{ width: 2, height: b.h, borderRadius: 1, backgroundColor: b.c }} />
        ))}
      </View>
    </View>
  );
}
