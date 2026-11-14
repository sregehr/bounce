import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { ConvexProvider, ConvexReactClient } from 'convex/react';

import BounceAudio, { AudioStatus, LatencyResult, MeterEvent, Recording } from '../../modules/bounce-audio';
import { Library } from './Library';

// Set by `npx convex dev` in .env.local. Without it the spike still runs, minus the library.
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false }) : null;

const C = {
  bg: '#121212',
  surface: '#1c1c1c',
  border: '#333333',
  dim: '#3a3a3a',
  text: '#f2f0ea',
  muted: '#a8a6a0',
  accent: '#ffb020',
  rec: '#ff4b3e',
};

type Mode = 'idle' | 'capturing' | 'looping' | 'measuring' | 'overdubbing' | 'mixing';

const ms = (v?: number) => (v == null ? '–' : `${v.toFixed(1)} ms`);
const dB = (v: number) => (v <= -99 ? '−∞ dB' : `${v.toFixed(1)} dB`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function App() {
  if (!convex) return <Spike />;
  return (
    <ConvexProvider client={convex}>
      <Spike library />
    </ConvexProvider>
  );
}

function Spike({ library }: { library?: boolean }) {
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [meter, setMeter] = useState<MeterEvent | null>(null);
  const [beat, setBeat] = useState<Recording | null>(null);
  const [take, setTake] = useState<Recording | null>(null);
  const [latency, setLatency] = useState<LatencyResult | null>(null);
  const [compensation, setCompensation] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const meterSub = BounceAudio.addListener('onMeter', setMeter);
    const routeSub = BounceAudio.addListener('onRouteChange', (next) => {
      setStatus(next);
      // A route change stops the engine, so whatever was running is over.
      if (!next.engineRunning) setMode('idle');
    });
    run(async () => {
      const granted = await BounceAudio.requestPermission();
      if (!granted) throw new Error('Microphone access was denied. Allow it in Settings to test capture.');
      setStatus(await BounceAudio.configure(48000, 256));
    });
    return () => {
      meterSub.remove();
      routeSub.remove();
    };
  }, []);

  /** Runs a native call and shows any failure on screen instead of losing it. */
  async function run(action: () => Promise<void>) {
    try {
      setError(null);
      await action();
    } catch (e) {
      setMode('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const refresh = async () => setStatus(await BounceAudio.getStatus());

  const stop = () =>
    run(async () => {
      await BounceAudio.stop();
      setMode('idle');
      await refresh();
    });

  const toggleCapture = () =>
    run(async () => {
      if (mode === 'capturing') {
        setBeat(await BounceAudio.stopRecording());
        setTake(null);
        setMode('idle');
      } else {
        setMeter(null);
        await BounceAudio.startCapture();
        setMode('capturing');
      }
      await refresh();
    });

  const moveInputPair = (step: number) =>
    run(async () => {
      const max = Math.max(0, status!.hardwareInputChannels - 2);
      const next = Math.max(0, Math.min(max, status!.firstInputChannel + step));
      setStatus(await BounceAudio.setFirstInputChannel(next));
    });

  const toggleLoop = () =>
    mode === 'looping'
      ? stop()
      : run(async () => {
          await BounceAudio.startLoop(beat!.uri);
          setMode('looping');
        });

  const measure = () =>
    run(async () => {
      setMode('measuring');
      const result = await BounceAudio.measureLatency();
      setLatency(result);
      if (result.medianMs != null) setCompensation(Math.round(result.medianMs));
      setMode('idle');
      await refresh();
    });

  const toggleOverdub = () =>
    run(async () => {
      if (mode === 'overdubbing') {
        setTake(await BounceAudio.stopRecording());
        setMode('idle');
      } else {
        setMeter(null);
        await BounceAudio.startOverdub(beat!.uri);
        setMode('overdubbing');
      }
    });

  const toggleMix = () =>
    mode === 'mixing'
      ? stop()
      : run(async () => {
          await BounceAudio.playMix(beat!.uri, take!.uri, compensation);
          setMode('mixing');
        });

  if (Platform.OS !== 'ios') {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={styles.title}>Audio spike</Text>
        <Text style={styles.muted}>The spike engine runs on iOS only for now.</Text>
      </View>
    );
  }

  const busy = (allowed: Mode) => mode !== 'idle' && mode !== allowed;
  const input = status?.inputs[0];
  const output = status?.outputs[0];

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Audio spike</Text>
        {error && <Text style={styles.error}>{error}</Text>}

        <Card title="Session">
          <Row label="Input" value={input ? `${input.name} (${input.type})` : 'None'} />
          <Row label="Output" value={output ? `${output.name} (${output.type})` : 'None'} />
          <Row
            label="Format"
            value={status ? `${(status.sampleRate / 1000).toFixed(1)} kHz · ${status.inputChannels} in (max ${status.maxInputChannels}) · ${status.outputChannels} out` : '–'}
          />
          <Row label="IO buffer" value={status ? `${status.ioBufferFrames} frames · ${ms(status.ioBufferMs)}` : '–'} />
          <Row label="Reported latency" value={status ? `in ${ms(status.inputLatencyMs)} · out ${ms(status.outputLatencyMs)}` : '–'} />
        </Card>

        <Card title="1 · Capture a beat">
          <Text style={styles.muted}>Plug in the MPC (or use the mic), start, then play the beat.</Text>
          {status && status.hardwareInputChannels > 2 && (
            <>
              <Row
                label="Recording inputs"
                value={`${status.firstInputChannel + 1}–${status.firstInputChannel + 2} of ${status.hardwareInputChannels}`}
              />
              <View style={styles.rowGap}>
                {[-2, 2].map((step) => (
                  <Button key={step} small label={step < 0 ? 'Previous pair' : 'Next pair'} disabled={mode !== 'idle'} onPress={() => moveInputPair(step)} />
                ))}
              </View>
            </>
          )}
          {(mode === 'capturing' || mode === 'overdubbing') && meter && (
            <View style={styles.gap}>
              <Text style={styles.big}>{clock(meter.seconds)}</Text>
              {meter.peaksDb.map((peak, i) => (
                <Meter key={i} label={meter.peaksDb.length === 2 ? 'LR'[i] : String(i + 1)} peakDb={peak} />
              ))}
              {meter.clipped && <Text style={styles.error}>Clipping: turn the source down.</Text>}
            </View>
          )}
          <Button label={mode === 'capturing' ? 'Stop capture' : 'Start capture'} tone={mode === 'capturing' ? 'rec' : 'accent'} disabled={busy('capturing')} onPress={toggleCapture} />
          {beat && (
            <Row
              label="Captured"
              value={`${clock(beat.durationSec)} · ${beat.channels} ch · ${beat.sampleRate / 1000} kHz · ${beat.bitDepth}-bit · peak ${dB(beat.peakDb)}${beat.clipped ? ' · clipped' : ''}`}
            />
          )}
        </Card>

        <Card title="2 · Loop it">
          <Button label={mode === 'looping' ? 'Stop loop' : 'Play loop'} disabled={!beat || busy('looping')} onPress={toggleLoop} />
        </Card>

        <Card title="3 · Measure round-trip latency">
          <Text style={styles.muted}>Plays six clicks and listens for them. Turn the volume up and keep the room quiet.</Text>
          <Button label={mode === 'measuring' ? 'Measuring…' : 'Run latency test'} disabled={mode !== 'idle'} onPress={measure} />
          {latency && (
            <>
              <Row label="Clicks heard" value={`${latency.detected} of ${latency.clicks}`} />
              <Row label="Measured" value={latency.medianMs == null ? 'Not detected' : `${ms(latency.medianMs)} (range ${ms(latency.minMs)} to ${ms(latency.maxMs)})`} />
              <Row label="System reports" value={ms(latency.reportedMs)} />
              <Row label="Noise floor" value={dB(latency.noiseFloorDb)} />
            </>
          )}
        </Card>

        <Card title="4 · Overdub a take">
          <Text style={styles.muted}>The loop plays and the input records from the same instant. Use headphones.</Text>
          <Button label={mode === 'overdubbing' ? 'Stop take' : 'Record over loop'} tone={mode === 'overdubbing' ? 'rec' : 'accent'} disabled={!beat || busy('overdubbing')} onPress={toggleOverdub} />
          {take && <Row label="Take" value={`${clock(take.durationSec)} · ${take.channels} ch · peak ${dB(take.peakDb)} · started ${ms(take.lateMs)} late`} />}
        </Card>

        <Card title="5 · Play the mix">
          <Row label="Compensation" value={`${compensation} ms`} />
          <View style={styles.rowGap}>
            {[-10, -1, 1, 10].map((step) => (
              <Button key={step} small label={step > 0 ? `+${step}` : `${step}`} disabled={mode !== 'idle'} onPress={() => setCompensation(compensation + step)} />
            ))}
          </View>
          <Button label={mode === 'mixing' ? 'Stop' : 'Play loop + take'} disabled={!beat || !take || busy('mixing')} onPress={toggleMix} />
        </Card>

        {library && <Library beat={mode === 'capturing' ? null : beat} />}
      </ScrollView>
    </View>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Meter({ label, peakDb }: { label: string; peakDb: number }) {
  // −60 dB to 0 dB across the bar.
  const pct = Math.max(0, Math.min(100, ((peakDb + 60) / 60) * 100));
  return (
    <View style={styles.meterRow}>
      <Text style={styles.meterLabel}>{label}</Text>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${pct}%`, backgroundColor: peakDb > -1 ? C.rec : C.text }]} />
      </View>
      <Text style={styles.meterValue}>{dB(peakDb)}</Text>
    </View>
  );
}

function Button({ label, onPress, disabled, tone = 'accent', small }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'accent' | 'rec'; small?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: disabled ? C.dim : tone === 'rec' ? C.rec : C.accent, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.buttonLabel, disabled && { color: C.muted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  content: { padding: 16, paddingTop: 72, paddingBottom: 48, gap: 12 },
  title: { color: C.text, fontSize: 28, fontWeight: '700' },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  error: { color: C.rec, fontSize: 14, lineHeight: 20 },
  big: { color: C.text, fontSize: 44, fontWeight: '700', fontVariant: ['tabular-nums'] },
  card: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  eyebrow: { color: C.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1.2 },
  gap: { gap: 6 },
  rowGap: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { color: C.muted, fontSize: 14 },
  rowValue: { color: C.text, fontSize: 14, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meterLabel: { color: C.muted, fontSize: 12, width: 12 },
  meterTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.dim, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
  meterValue: { color: C.muted, fontSize: 12, width: 64, textAlign: 'right', fontVariant: ['tabular-nums'] },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonSmall: { flex: 1, minHeight: 44 },
  buttonLabel: { color: C.bg, fontSize: 16, fontWeight: '600' },
});
