import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Rect } from 'react-native-svg';
import { router, useLocalSearchParams } from 'expo-router';

import { importBeat } from '@/data/beats';
import type { Project } from '@/data/model';
import { setProfile, setSettings, useLibrary } from '@/data/store';
import { measureLatency, openInput, reportedLatencyMs, setPair, useEngine } from '@/engine/engine';
import { Btn, Card, Eyebrow, Foot, Muted, NavLink, Screen, TopBar, Txt, s } from '@/ui/kit';
import { Logo } from '@/ui/Logo';
import { estimateMs } from '@/data/timing';
import { useTiming } from '@/ui/timing';
import { useTask } from '@/ui/hooks';
import { asSheet, useSheet } from '@/ui/nav';
import { ClapCheck, InputPanel, type ClapOutcome } from '@/ui/parts';
import { C } from '@/ui/theme';
import { useWide } from '@/ui/wide';

// The first launch is one screen: what Bounce is, and the three ways to bring in a beat. Everything it used to ask first
// (a name, an account, the microphone, the timing) is asked where it is needed. The two setup steps remain, as a sheet.
type StepId = 'welcome' | 'sound' | 'timing';

function Choice({ title, body, onPress, primary, disabled }: { title: string; body: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: primary ? C.accent : C.surface, borderWidth: primary ? 0 : 1, borderColor: C.border, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 20, gap: 4, opacity: disabled ? 0.5 : pressed ? 0.9 : 1 })}
    >
      <Txt size={19} w="display" ls={0} color={primary ? C.bg : C.text}>
        {title}
      </Txt>
      <Txt size={14} lh={1.4} color={primary ? C.bg : C.muted}>
        {body}
      </Txt>
    </Pressable>
  );
}

/** The brand panel down the left of the wide layout. The mark is drawn dark here, because the usual one has an amber ball that would vanish into the panel. */
function Brand() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ width: '45%', backgroundColor: C.accent, justifyContent: 'space-between', paddingLeft: insets.left + 56, paddingRight: 56, paddingTop: Math.max(56, insets.top + 16), paddingBottom: Math.max(56, insets.bottom + 16) }}>
      <Svg width={72} height={72} viewBox="0 0 62 62" accessibilityLabel="Bounce logo">
        <Rect x={0} y={0} width={27} height={27} rx={7} fill={C.bg} />
        <Rect x={35} y={0} width={27} height={27} rx={7} fill={C.bg} />
        <Rect x={0} y={35} width={27} height={27} rx={7} fill={C.bg} />
        <Circle cx={48.5} cy={48.5} r={14.5} fill={C.text} />
      </Svg>
      <View style={{ gap: 20 }}>
        <Txt size={120} w="display" ls={-0.04} lh={0.95} color={C.bg}>
          Bounce
        </Txt>
        <Txt size={28} w="displayMedium" lh={1.25} color={C.bg}>
          Capture a beat. Freestyle over it. Hear it mastered in seconds.
        </Txt>
      </View>
    </View>
  );
}

function Onboarding() {
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const settings = useLibrary((l) => l.settings);
  const input = useEngine((e) => e.input);
  // Opened from the mic screen or Settings, this is just the two setup steps (sound check, timing) and then back again.
  const params = useLocalSearchParams<{ setup?: string }>();
  const setup = !!params.setup;
  const [step, setStep] = useState<StepId>(setup ? 'sound' : 'welcome');
  const sheet = useSheet();
  const leave = () => (sheet ? sheet.close() : router.canGoBack() ? router.back() : router.replace('/'));
  const [timing, setTiming] = useState<{ ms: number; measured: boolean; heard: number; of: number; /** Done by hand, and how: clapped or tapped. */ by?: 'claps' | 'taps' } | null>(null);
  const [tapping, setTapping] = useState(false);
  const check = useTask();
  const start = useTask();
  const live = input.status === 'ready';

  const route = useTiming();
  // What this setup starts at before any check: 84 ms on a phone's own microphone, 230 ms on wireless earbuds, and so on.
  const estimate = estimateMs(route.route, reportedLatencyMs());
  const setupName = [route.route.input, route.route.output].filter(Boolean).join(' and ') || 'this setup';
  const runCheck = () =>
    check.run(async () => {
      const result = await measureLatency();
      const ms = result.medianMs !== null ? Math.round(result.medianMs) : estimate;
      route.set(result.medianMs !== null ? ms : null);
      setTiming({ ms, measured: result.medianMs !== null, heard: result.detected, of: result.clicks });
    });
  const clapped = (outcome: ClapOutcome) => {
    setTapping(false);
    const ms = outcome.ms !== null ? Math.min(500, outcome.ms) : estimate;
    route.set(outcome.ms !== null ? ms : null);
    setTiming({ ms, measured: outcome.ms !== null, heard: outcome.matched, of: outcome.clicks, by: outcome.by });
  };
  const finish = (work?: () => Promise<Project | null>, to: '/vocals' | '/capture' | '/demos' | '/' = '/vocals') =>
    start.run(async () => {
      if (work && !(await work())) return;
      setProfile({ onboarded: true });
      router.replace(to);
    });

  // Only the next useful action is amber: connecting, then continuing; a check that failed leads with the way that works.
  const failed = !!timing && !timing.measured;
  const measured = timing ? timing.measured : route.measured;
  const steps = (
    <>
      {/* The first of the two setup steps closes the sheet; the second steps back to the first. */}
      {setup && <TopBar back={step === 'timing' ? { onBack: () => setStep('sound') } : true} left="Setup" />}

      {step === 'welcome' && (
        <>
          {/* In the wide layout the brand panel already says this. */}
          {!wide && (
            <View style={{ gap: 12, paddingTop: 28 }}>
              <Logo size={44} />
              <Txt size={56} w="display" ls={-0.04} lh={1}>
                Bounce
              </Txt>
              <Txt size={20} w="displayMedium" lh={1.25}>
                Capture a beat. Freestyle over it. Hear it mastered in seconds.
              </Txt>
            </View>
          )}
          <View style={{ gap: 8, paddingTop: wide ? 40 : 8 }}>
            {wide ? (
              <Txt size={34} w="display" lh={1.05}>
                Pick a beat to start
              </Txt>
            ) : (
              <Eyebrow>Pick a beat to start</Eyebrow>
            )}
          </View>
          {start.error && (
            <Txt size={14} color={C.recText}>
              {start.error}
            </Txt>
          )}
          <View style={{ gap: 12 }}>
            <Choice primary title="Try a demo beat" body="No gear needed: pick a ready-made beat and go straight to the mic." disabled={start.busy} onPress={() => finish(undefined, '/demos')} />
            <Choice title="Capture from your gear" body="Plug in your MPC, sampler or audio interface by USB and press play." disabled={start.busy} onPress={() => finish(undefined, '/capture')} />
            <Choice title="Import a file" body="A WAV, MP3 or M4A of a beat you already have." disabled={start.busy} onPress={() => finish(importBeat)} />
          </View>
          <Foot>
            <NavLink tone="quiet" center size={14} onPress={() => finish(undefined, '/')}>
              Just look around first
            </NavLink>
            <Muted size={13} center>
              Everything is saved on this device. No account needed.
            </Muted>
          </Foot>
        </>
      )}

      {step === 'sound' && (
        <>
          <View style={{ gap: 8, paddingTop: 24 }}>
            <Txt size={34} w="display" lh={1.05}>
              Sound check
            </Txt>
            <Muted size={15}>{live ? 'Make some noise: the meters should move. Wear headphones when you record vocals, so the beat stays out of the mic.' : 'Pick the input Bounce records from: a microphone for vocals, or your MPC, sampler or audio interface over USB.'}</Muted>
          </View>
          <Card>
            <View style={[s.row, { gap: 8 }]}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: live ? C.accent : C.dim }} />
              <Eyebrow accent={live}>{live ? 'Connected' : input.status === 'opening' ? 'Connecting' : 'Not connected'}</Eyebrow>
            </View>
            {live ? (
              <InputPanel
                input={input}
                onPair={setPair}
                onPick={(deviceId) => {
                  setSettings({ inputId: deviceId });
                  void openInput(deviceId);
                }}
              />
            ) : (
              <>
                <Muted>{input.error ?? 'The browser will ask for permission. Bounce only listens while you are capturing or recording.'}</Muted>
                <Btn label={input.error ? 'Try again' : 'Connect an input'} busy={input.status === 'opening'} onPress={() => void openInput(settings.inputId, 'mic')} />
              </>
            )}
          </Card>
          <Foot>
            {/* Until an input is connected, connecting is the one thing to do here; the close button leaves. */}
            {live ? (
              <Btn label="Continue" onPress={() => setStep('timing')} />
            ) : (
              <NavLink tone="quiet" center size={14} onPress={leave}>
                Skip for now
              </NavLink>
            )}
          </Foot>
        </>
      )}

      {step === 'timing' && (
        <>
          <View style={{ gap: 8, paddingTop: 24 }}>
            <Txt size={34} w="display" lh={1.05}>
              Line up your takes
            </Txt>
            <Muted size={15}>Every setup hears itself a little late. Bounce plays six clicks and listens for them, then shifts your vocals by exactly that much so they land on the beat.</Muted>
          </View>
          <Card>
            <Eyebrow accent={measured}>{measured ? 'Measured' : 'Using an estimate'}</Eyebrow>
            <Txt size={44} w="display" lh={1}>
              {timing ? timing.ms : route.ms} ms
            </Txt>
            {tapping ? (
              <ClapCheck input={input} onDone={clapped} onCancel={() => setTapping(false)} />
            ) : (
              <>
                <Muted>
                  {check.error ??
                    (timing
                      ? timing.measured
                        ? timing.by
                          ? `Measured from ${timing.heard} of ${timing.of} ${timing.by}. Your takes will be moved ${timing.ms} ms earlier.`
                          : `Heard all the clicks it needed (${timing.heard} of ${timing.of}). Your takes will be moved ${timing.ms} ms earlier.`
                        : timing.by
                          ? `Only ${timing.heard} of ${timing.of} ${timing.by} lined up, so the estimate for this setup is used. Try again, right on each click.`
                          : `Only ${timing.heard} of ${timing.of} clicks came back, so the estimate for this setup is used. With headphones on, hold one ear cup to the mic and try again, or clap or tap along instead.`
                      : `${route.measured ? `Measured for ${setupName}.` : `An estimate for ${setupName}.`} For an exact figure, turn the volume up and take your headphones off, or hold one ear cup to the mic. The clicks are short and loud.`)}
                </Muted>
                {failed ? (
                  // The clicks did not come back, which is what earbuds do: the way that works with them leads.
                  <>
                    <Btn label="Clap or tap along" disabled={check.busy} onPress={() => setTapping(true)} />
                    <Btn kind="outline" label="Run it again" busy={check.busy} onPress={runCheck} style={{ flex: 0 }} />
                  </>
                ) : (
                  <>
                    <Btn kind={timing ? 'outline' : 'primary'} label={timing ? 'Run it again' : 'Play the clicks'} busy={check.busy} onPress={runCheck} style={timing ? { flex: 0 } : undefined} />
                    <NavLink center size={14} onPress={() => !check.busy && setTapping(true)}>
                      Wearing earbuds? Clap or tap along instead
                    </NavLink>
                  </>
                )}
              </>
            )}
          </Card>
          <Foot>
            {/* Done is the amber button only once there is a measured figure to be done with. */}
            <Btn kind={timing?.measured ? 'primary' : 'outline'} label={timing?.measured ? 'Done' : 'Use the estimate'} onPress={leave} disabled={check.busy || tapping} />
          </Foot>
        </>
      )}
    </>
  );

  // Wide: the brand stays down the left through every step, and the step itself sits in a column on the right.
  if (wide)
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
        <Brand />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingLeft: 72, paddingRight: insets.right + 72, paddingTop: Math.max(56, insets.top + 16), paddingBottom: Math.max(56, insets.bottom + 16) }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexGrow: 1, width: '100%', maxWidth: 520, gap: 20 }}>{steps}</View>
        </ScrollView>
      </View>
    );

  return (
    <Screen gap={20} padBottom={32}>
      {steps}
    </Screen>
  );
}

// The first time it is the whole screen. Opened again from the mic screen for the two setup steps, it is a sheet over that screen.
export default asSheet(Onboarding, { when: (params) => !!params.setup, fallback: '/vocals' });
