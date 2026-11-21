import { useState } from 'react';
import { View } from 'react-native';

import { setSettings, useLibrary } from '@/data/store';
import { measureLatency, openInput, setPair, useEngine } from '@/engine/engine';

import { useTask } from './hooks';
import { Btn, Card, Chip, Muted, NavLink, Txt, s } from './kit';
import { ClapCheck, InputPanel, type ClapOutcome } from './parts';
import { C } from './theme';
import { useTiming } from './timing';

/**
 * Which microphone records, and how far takes are shifted to land on the beat. It lives where
 * recording happens, since both only matter while a take is being made.
 */
export function MicSetup() {
  const settings = useLibrary((l) => l.settings);
  const input = useEngine((e) => e.input);
  const check = useTask();
  const [heard, setHeard] = useState<string | null>(null);
  const [tapping, setTapping] = useState(false);
  const live = input.status === 'ready';
  const timing = useTiming();
  const latency = timing.ms;

  const runCheck = () =>
    check.run(async () => {
      const result = await measureLatency();
      if (result.medianMs === null) {
        setHeard(`Only ${result.detected} of 6 clicks came back, so nothing was changed. Turn the volume up, or hold one ear cup to the mic.`);
        return;
      }
      timing.set(result.medianMs);
      setHeard(`Measured ${Math.round(result.medianMs)} ms from ${result.detected} clicks.`);
    });

  const clapped = (outcome: ClapOutcome) => {
    setTapping(false);
    if (outcome.ms === null) {
      setHeard(`Only ${outcome.matched} of ${outcome.clicks} ${outcome.by} lined up, so nothing was changed. Try again, right on each click.`);
      return;
    }
    timing.set(Math.min(500, outcome.ms));
    // Taps time the delay to the ears; the microphone's own small delay is not in them.
    setHeard(`Measured ${Math.min(500, outcome.ms)} ms from ${outcome.matched} ${outcome.by}. ${outcome.by === 'taps' ? 'Tapping leaves out the microphone’s own delay, so nudge' : 'Nudge'} it with −5 and +5 if takes still sit early or late.`);
  };

  // Each setup keeps its own figure, so switching to a wireless speaker and back needs no re-check.
  const setupName = [timing.route.input, timing.route.output].filter(Boolean).join(' and ') || 'this setup';

  return (
    <View style={{ gap: 14, paddingBottom: 12 }}>
      <Card style={{ padding: 16 }}>
        {live ? (
          <InputPanel
            input={input}
            onPair={setPair}
            onPick={(deviceId) => {
              setSettings({ inputId: deviceId });
              void openInput(deviceId, 'mic');
            }}
          />
        ) : (
          <>
            <Muted>{input.error ?? 'Connect to choose which microphone Bounce records from and to see its level.'}</Muted>
            <Btn kind="outline" label="Connect a microphone" busy={input.status === 'opening'} onPress={() => void openInput(settings.inputId, 'mic')} style={{ flex: 0 }} />
          </>
        )}
      </Card>

      <View style={[s.row, s.between]}>
        <View style={{ gap: 2, flex: 1 }}>
          <Txt size={24} w="display" ls={0}>
            {latency} ms
          </Txt>
          <Muted size={13}>{timing.measured ? `Measured for ${setupName}. New takes are moved this much earlier.` : `An estimate for ${setupName}. Run the check for an exact figure.`}</Muted>
        </View>
        <View style={[s.row, { gap: 6 }]}>
          <Chip label="−5" onPress={() => timing.set(latency - 5)} style={{ paddingHorizontal: 12 }} />
          <Chip label="+5" onPress={() => timing.set(latency + 5)} style={{ paddingHorizontal: 12 }} />
        </View>
      </View>
      {(check.error || heard) && (
        <Txt size={13} color={check.error ? C.recText : C.muted}>
          {check.error ?? heard}
        </Txt>
      )}
      {tapping ? (
        <Card style={{ padding: 16 }}>
          <ClapCheck input={input} onDone={clapped} onCancel={() => setTapping(false)} />
        </Card>
      ) : (
        <>
          <View style={[s.row, { gap: 10 }]}>
            <Btn kind="outline" label="Play the clicks" busy={check.busy} disabled={!live} onPress={runCheck} style={{ flex: 1 }} />
            <Btn kind="outline" label="Clap or tap along" disabled={!live || check.busy} onPress={() => (setHeard(null), setTapping(true))} style={{ flex: 1 }} />
          </View>
          <Muted size={13}>Each microphone and speaker keeps its own timing, and Bounce switches between them as you connect them.</Muted>
          <Muted size={13}>{live ? 'Wearing earbuds? The mic cannot hear the clicks through them, so clap or tap along instead.' : 'Connect a microphone to run a check.'}</Muted>
          {timing.measured && (
            <NavLink size={14} onPress={() => (timing.set(null), setHeard(null))}>
              Use the estimate
            </NavLink>
          )}
          <NavLink size={14} to="/onboarding?setup=1">
            Walk me through the setup again
          </NavLink>
        </>
      )}
    </View>
  );
}
