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

const BAR_COUNT = 68;

export default function Record() {
  const input = useEngine((e) => e.input);
  const cap = useEngine((e) => e.capture);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const recording = cap.status === 'recording';

  useOnScreen(() => {
    armCapture();
    // Leaving without pressing stop abandons the take.
    return cancelCapture;
  });

  const save = async (captured: Captured, cutShort = false) => {
    setSaving(true);
    try {
      await addBeat({ channels: captured.channels, sampleRate: captured.sampleRate }, { source: 'capture', label: captured.label, name: nextBeatName(), clipped: captured.clipped });
      router.replace('/beat');
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

  const recent = cap.wave.slice(-BAR_COUNT);
  const bars: Bar[] = Array.from({ length: BAR_COUNT }, (_, i) => (i < recent.length ? { h: Math.round(8 + Math.sqrt(recent[i]) * 104), c: C.text } : { h: 4, c: C.dim }));

  const finish = async () => {
    const captured = stopCapture();
    if (!captured) {
      router.replace('/capture');
      return;
    }
    await save(captured);
  };

  return (
    <Screen gap={28} padBottom={40}>
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

      <View style={{ alignItems: 'center', gap: 6, paddingTop: 24 }}>
        <Txt size={84} w="display" ls={-0.03} lh={1} style={{ fontVariant: ['tabular-nums'] }}>
          {clock(cap.elapsed)}
        </Txt>
        <Muted>{saving ? 'Trimming silence and finding the tempo' : recording ? 'Started automatically at first sound' : `Press play on ${gearName(input.label)} to start`}</Muted>
        {notice && !recording && (
          <Txt size={14} color={C.recText} center>
            {notice}
          </Txt>
        )}
      </View>

      <Bars bars={bars} height={120} />

      <Card style={{ paddingVertical: 18, paddingHorizontal: 20, gap: 12 }}>
        <View style={[s.row, s.between]}>
          <Eyebrow>Input level</Eyebrow>
          <Txt size={13} w="medium" color={cap.clipped ? C.recText : C.text}>
            {!recording ? 'Waiting for sound' : `Peak ${db(toDb(cap.peak), 1)} · ${cap.clipped ? 'clipping' : 'no clipping'}`}
          </Txt>
        </View>
        <Meter label="L" pct={meterPct(input.levelL)} height={8} />
        <Meter label="R" pct={meterPct(input.levelR)} height={8} />
      </Card>

      <Foot center gap={16}>
        <StopButton size={96} label={recording ? 'Stop recording' : 'Cancel'} onPress={finish} disabled={saving} />
        <Muted center style={{ maxWidth: 280 }}>
          {recording ? 'Stop when the beat ends. Silence at the start and end gets trimmed for you.' : 'Nothing is recorded until there is sound.'}
        </Muted>
        {!recording && !saving && (
          <NavLink center size={14} onPress={startCaptureNow}>
            Start recording now instead
          </NavLink>
        )}
      </Foot>
    </Screen>
  );
}
