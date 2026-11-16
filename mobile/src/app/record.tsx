import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';

import { gearName } from '@/data/labels';
import { nextBeatName } from '@/data/store';
import { addBeat, TooShort } from '@/data/studio';
import { toDb } from '@/dsp/core';
import { armCapture, cancelCapture, startCaptureNow, stopCapture, takeSalvaged, useEngine } from '@/engine/engine';
import type { Captured } from '@/engine/types';
import { Bars, Card, Eyebrow, Foot, Meter, Muted, NavLink, Screen, StopButton, Txt, s, type Bar } from '@/ui/kit';
import { useOnScreen } from '@/ui/hooks';
import { C, clock, db, meterPct, rateLabel } from '@/ui/theme';
import { useWide } from '@/ui/wide';

const BAR_COUNT = 68;
// The wide layout spreads twice as many across the screen.
const BAR_COUNT_WIDE = 136;

export default function Record() {
  const input = useEngine((e) => e.input);
  const cap = useEngine((e) => e.capture);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const recording = cap.status === 'recording';
  const wide = useWide();

  useOnScreen(() => {
    armCapture();
    // Leaving without pressing stop abandons the take.
    return cancelCapture;
  });

  const save = async (captured: Captured, cutShort = false) => {
    setSaving(true);
    try {
      await addBeat({ channels: captured.channels, sampleRate: captured.sampleRate }, { source: 'capture', label: captured.label, name: nextBeatName(), clipped: captured.clipped });
      router.replace('/song');
    } catch (e) {
      setSaving(false);
      setNotice(e instanceof TooShort ? e.message : 'That capture could not be saved. Storage on this device may be full.');
      if (cutShort) router.replace('/capture');
      else armCapture();
    }
  };

  // If the cable comes out mid-capture, keep what was recorded up to that point.
  useEffect(() => {
    if (input.status === 'ready' || saving) return;
    const captured = takeSalvaged();
    if (captured) void save(captured, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.status]);

  if (input.status !== 'ready' && !saving) return <Redirect href="/capture" />;

  const count = wide ? BAR_COUNT_WIDE : BAR_COUNT;
  const recent = cap.wave.slice(-count);
  const bars: Bar[] = Array.from({ length: count }, (_, i) => (i < recent.length ? { h: Math.round(8 + Math.sqrt(recent[i]) * (wide ? 134 : 104)), c: C.text } : { h: 4, c: C.dim }));

  const finish = async () => {
    const captured = stopCapture();
    if (!captured) {
      router.replace('/capture');
      return;
    }
    await save(captured);
  };

  const status = (
    <View style={s.topbar}>
      <View style={[s.row, { gap: 10 }]}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: recording ? C.rec : C.accent }} />
        <Eyebrow size={13} color={recording ? C.recText : C.accent}>
          {saving ? 'Saving' : recording ? 'Recording' : 'Armed'}
        </Eyebrow>
      </View>
      <Txt size={13} color={C.muted} numberOfLines={1} style={{ flexShrink: 1 }}>
        {input.label} · {rateLabel(input.sampleRate)}
      </Txt>
    </View>
  );

  const time = (
    <View style={{ alignItems: 'center', gap: 6, paddingTop: wide ? 0 : 24 }}>
      <Txt size={wide ? 160 : 84} w="display" ls={-0.03} lh={1} style={{ fontVariant: ['tabular-nums'] }}>
        {clock(cap.elapsed)}
      </Txt>
      <Muted size={wide ? 16 : 14}>{saving ? 'Trimming silence and finding the tempo' : recording ? 'Started automatically at first sound' : `Press play on ${gearName(input.label)} to start`}</Muted>
      {notice && !recording && (
        <Txt size={14} color={C.recText} center>
          {notice}
        </Txt>
      )}
    </View>
  );

  const level = (
    <Card style={[{ paddingVertical: 18, paddingHorizontal: 20, gap: 12 }, wide && { flex: 1 }]}>
      <View style={[s.row, s.between]}>
        <Eyebrow>Input level</Eyebrow>
        <Txt size={13} w="medium" color={cap.clipped ? C.recText : C.text}>
          {!recording ? 'Waiting for sound' : `Peak ${db(toDb(cap.peak), 1)} · ${cap.clipped ? 'clipping' : 'no clipping'}`}
        </Txt>
      </View>
      <Meter label="L" pct={meterPct(input.levelL)} height={8} />
      <Meter label="R" pct={meterPct(input.levelR)} height={8} />
    </Card>
  );

  const stop = <StopButton size={wide ? 112 : 96} label={recording ? 'Stop recording' : 'Cancel'} onPress={finish} disabled={saving} />;
  const hint = recording ? 'Stop when the beat ends. Silence at the start and end gets trimmed for you.' : 'Nothing is recorded until there is sound.';
  const startNow = !recording && !saving && (
    <NavLink center={!wide} size={14} onPress={startCaptureNow}>
      Start recording now instead
    </NavLink>
  );

  // Wide: the clock and the waveform take the middle of the screen, and the level, the stop button and its hint share the bottom row.
  if (wide)
    return (
      <Screen gap={28} style={{ justifyContent: 'space-between' }}>
        {status}
        {time}
        <View accessible={false} style={{ height: 150, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' }}>
          {bars.map((b, i) => (
            <View key={i} style={{ width: 4, height: b.h, borderRadius: 2, backgroundColor: b.c }} />
          ))}
        </View>
        <View style={[s.row, { gap: 48 }]}>
          {level}
          {stop}
          <View style={{ flex: 1, gap: 4 }}>
            <Muted size={15} lh={1.5}>
              {hint}
            </Muted>
            {startNow}
          </View>
        </View>
      </Screen>
    );

  return (
    <Screen gap={28} padBottom={40}>
      {status}

      {time}

      <Bars bars={bars} height={120} />

      {level}

      <Foot center gap={16}>
        {stop}
        <Muted center style={{ maxWidth: 280 }}>
          {hint}
        </Muted>
        {startNow}
      </Foot>
    </Screen>
  );
}
