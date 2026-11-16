import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AccountStep } from '@/auth/account';
import { backendAvailable } from '@/auth/backend';
import { importBeat } from '@/data/beats';
import type { Project } from '@/data/model';
import { setProfile, setSettings, useLibrary } from '@/data/store';
import { measureLatency, openInput, reportedLatencyMs, setPair, useEngine } from '@/engine/engine';
import { Btn, Card, Eyebrow, Field, Foot, Muted, NavLink, Screen, TickIcon, TopBar, Txt, s } from '@/ui/kit';
import { Logo } from '@/ui/Logo';
import { useTiming } from '@/ui/timing';
import { useTask } from '@/ui/hooks';
import { ClapCheck, InputPanel, type ClapOutcome } from '@/ui/parts';
import { C } from '@/ui/theme';

type StepId = 'welcome' | 'names' | 'account' | 'sound' | 'timing' | 'first';
// The account step is only there when the build has a server to sign in to.
const STEPS: StepId[] = backendAvailable ? ['welcome', 'names', 'account', 'sound', 'timing', 'first'] : ['welcome', 'names', 'sound', 'timing', 'first'];

function Dots({ at }: { at: StepId }) {
  const step = STEPS.indexOf(at);
  return (
    <View accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`} style={[s.row, { gap: 6 }]}>
      {STEPS.map((name, i) => (
        <View key={name} style={{ height: 4, flex: 1, borderRadius: 2, backgroundColor: i <= step ? C.accent : C.dim }} />
      ))}
    </View>
  );
}

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

export default function Onboarding() {
  const profile = useLibrary((l) => l.profile);
  const settings = useLibrary((l) => l.settings);
  const input = useEngine((e) => e.input);
  // Opened from the mic screen, this is just the two setup steps (sound check, timing) and then back again.
  const params = useLocalSearchParams<{ setup?: string; step?: string }>();
  const setup = !!params.setup;
  // Signing in on the web leaves the page and comes back to the account step.
  const [step, setStep] = useState<StepId>(setup ? 'sound' : params.step === 'account' && backendAvailable ? 'account' : 'welcome');
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const [artist, setArtist] = useState(profile.artist);
  const [producer, setProducer] = useState(profile.producer);
  const [timing, setTiming] = useState<{ ms: number; measured: boolean; heard: number; of: number; taps?: boolean } | null>(null);
  const [tapping, setTapping] = useState(false);
  const check = useTask();
  const start = useTask();
  const live = input.status === 'ready';

  const next = () => setStep((at) => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(at) + 1)]);
  const back = () => setStep((at) => STEPS[Math.max(0, STEPS.indexOf(at) - 1)]);
  const saveNames = () => {
    setProfile({ artist: artist.trim(), producer: producer.trim() });
    next();
  };
  const route = useTiming();
  const runCheck = () =>
    check.run(async () => {
      const result = await measureLatency();
      const ms = result.medianMs !== null ? Math.round(result.medianMs) : reportedLatencyMs();
      route.set(result.medianMs !== null ? ms : null);
      setTiming({ ms, measured: result.medianMs !== null, heard: result.detected, of: result.clicks });
    });
  const clapped = (outcome: ClapOutcome) => {
    setTapping(false);
    const ms = outcome.ms !== null ? Math.min(500, outcome.ms) : reportedLatencyMs();
    route.set(outcome.ms !== null ? ms : null);
    setTiming({ ms, measured: outcome.ms !== null, heard: outcome.matched, of: outcome.clicks, taps: true });
  };
  const finish = (work?: () => Promise<Project | null>, to: '/beat' | '/capture' | '/demos' | '/' = '/beat') =>
    start.run(async () => {
      if (work && !(await work())) return;
      setProfile({ onboarded: true });
      router.replace(to);
    });

  return (
    <Screen gap={20} padBottom={32}>
      {setup ? <TopBar left="Setup" right={<NavLink onPress={leave}>Done</NavLink>} /> : <Dots at={step} />}

      {step === 'welcome' && (
        <>
          <View style={{ gap: 12, paddingTop: 40 }}>
            <Logo size={52} />
            <Txt size={64} w="display" ls={-0.04} lh={1}>
              Bounce
            </Txt>
            <Txt size={22} w="displayMedium" lh={1.25}>
              Capture a beat. Freestyle over it. Hear it mastered in seconds.
            </Txt>
          </View>
          <View style={{ gap: 14, paddingTop: 16 }}>
            {['Record a beat straight from your MPC, or any sampler or audio interface', 'Loop a section and rap; every take is kept', 'One tap polishes the vocal and masters the song', 'Add a cover, cut a snippet, export the WAV'].map((line) => (
              <View key={line} style={[s.row, { gap: 12, alignItems: 'flex-start' }]}>
                <View style={{ paddingTop: 4 }}>
                  <TickIcon size={16} />
                </View>
                <Txt size={16} lh={1.4} style={{ flex: 1 }}>
                  {line}
                </Txt>
              </View>
            ))}
          </View>
          <Foot>
            <Btn label="Get started" onPress={next} />
            <Muted size={13} center>
              Everything is saved on this device. Backup can be turned off in Settings.
            </Muted>
          </Foot>
        </>
      )}

      {step === 'names' && (
        <>
          <View style={{ gap: 8, paddingTop: 24 }}>
            <Txt size={34} w="display" lh={1.05}>
              What do you go by?
            </Txt>
            <Muted size={15}>Your name goes on the player and on snippets you share. You can change it later.</Muted>
          </View>
          <View style={{ gap: 6 }}>
            <Eyebrow>Artist name</Eyebrow>
            <Field label="Artist name" value={artist} onChangeText={setArtist} placeholder="Your name or alias" maxLength={40} autoCapitalize="words" returnKeyType="next" />
          </View>
          <View style={{ gap: 6 }}>
            <Eyebrow>Who makes your beats?</Eyebrow>
            <Field label="Producer name" value={producer} onChangeText={setProducer} placeholder="Optional. Leave empty if it's you" maxLength={40} autoCapitalize="words" onSubmitEditing={saveNames} />
          </View>
          <Foot>
            <Btn label="Continue" onPress={saveNames} />
            <NavLink center size={14} onPress={() => setStep('welcome')}>
              Back
            </NavLink>
          </Foot>
        </>
      )}

      {step === 'account' && <AccountStep onNext={next} onBack={back} />}

      {step === 'sound' && (
        <>
          <View style={{ gap: 8, paddingTop: 24 }}>
            <Txt size={34} w="display" lh={1.05}>
              Sound check
            </Txt>
            <Muted size={15}>Bounce needs an audio input: your MPC, sampler or audio interface over USB to capture beats, and a microphone for vocals.</Muted>
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
          {live && <Muted size={13}>Make some noise: the meters should move. Wear headphones when you record vocals, so the beat stays out of the mic.</Muted>}
          <Foot>
            <Btn label="Continue" onPress={() => (live ? setStep('timing') : setup ? leave() : setStep('first'))} disabled={input.status === 'opening' || (setup && !live)} />
            {!live && !setup && (
              <NavLink center size={14} onPress={() => setStep('first')}>
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
            <Eyebrow accent={!!timing?.measured}>{timing ? (timing.measured ? 'Measured' : 'Using an estimate') : 'Not measured yet'}</Eyebrow>
            <Txt size={44} w="display" lh={1}>
              {timing ? `${timing.ms} ms` : `~${reportedLatencyMs()} ms`}
            </Txt>
            {tapping ? (
              <ClapCheck input={input} onDone={clapped} onCancel={() => setTapping(false)} />
            ) : (
              <>
                <Muted>
                  {check.error ??
                    (timing
                      ? timing.measured
                        ? timing.taps
                          ? `Measured from ${timing.heard} of ${timing.of} claps. Your takes will be moved ${timing.ms} ms earlier.`
                          : `Heard all the clicks it needed (${timing.heard} of ${timing.of}). Your takes will be moved ${timing.ms} ms earlier.`
                        : timing.taps
                          ? `Only ${timing.heard} of ${timing.of} claps lined up, so the browser's own estimate is used. Try again, clapping right on each click.`
                          : `Only ${timing.heard} of ${timing.of} clicks came back, so the browser's own estimate is used. With headphones on, hold one ear cup to the mic and try again, or clap along instead.`
                      : 'Turn the volume up and take your headphones off, or hold one ear cup to the mic. The clicks are short and loud.')}
                </Muted>
                <Btn kind={timing ? 'outline' : 'primary'} label={timing ? 'Run it again' : 'Play the clicks'} busy={check.busy} onPress={runCheck} style={timing ? { flex: 0 } : undefined} />
                <NavLink center size={14} onPress={() => !check.busy && setTapping(true)}>
                  Wearing earbuds? Clap along instead
                </NavLink>
              </>
            )}
          </Card>
          <Foot>
            <Btn label={setup ? 'Done' : 'Continue'} onPress={setup ? leave : next} disabled={check.busy || tapping} />
            {setup && (
              <NavLink center size={14} onPress={() => setStep('sound')}>
                Back to the sound check
              </NavLink>
            )}
            {!timing && !setup && (
              <NavLink center size={14} onPress={next}>
                Skip: use the estimate
              </NavLink>
            )}
          </Foot>
        </>
      )}

      {step === 'first' && (
        <>
          <View style={{ gap: 8, paddingTop: 24 }}>
            <Txt size={34} w="display" lh={1.05}>
              {artist.trim() ? `Ready, ${artist.trim()}.` : 'Ready.'}
            </Txt>
            <Muted size={15}>Start with a beat. Everything else follows from it.</Muted>
          </View>
          {start.error && (
            <Txt size={14} color={C.recText}>
              {start.error}
            </Txt>
          )}
          <View style={{ gap: 12 }}>
            <Choice primary title="Capture from your gear" body="Plug in your MPC, sampler or audio interface by USB and press play. Recording starts by itself." disabled={start.busy} onPress={() => finish(undefined, '/capture')} />
            <Choice title="Import a file" body="A WAV, MP3 or M4A of a beat you already have." disabled={start.busy} onPress={() => finish(importBeat)} />
            <Choice title="Try a demo song" body="No gear needed: pick a ready-made beat and go straight to the mic." disabled={start.busy} onPress={() => finish(undefined, '/demos')} />
          </View>
          <Foot>
            <NavLink center size={14} onPress={() => finish(undefined, '/')}>
              Just look around first
            </NavLink>
          </Foot>
        </>
      )}
    </Screen>
  );
}
