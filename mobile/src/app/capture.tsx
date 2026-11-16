import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { gearName } from '@/data/labels';
import { setSettings, useLibrary } from '@/data/store';
import { closeInput, inputAllowed, openInput, setPair, useEngine, wake } from '@/engine/engine';
import { Btn, Card, Eyebrow, Muted, NavLink, Screen, TopBar, Txt, s } from '@/ui/kit';
import { InputPanel } from '@/ui/parts';
import { C } from '@/ui/theme';

export default function Capture() {
  const input = useEngine((e) => e.input);
  const inputId = useLibrary((l) => l.settings.beatInputId);
  const live = input.status === 'ready';

  useEffect(() => {
    // Only connect on arrival when it will not throw a permission prompt at the user.
    void inputAllowed().then((ok) => void (ok && openInput(inputId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (deviceId: string) => {
    setSettings({ beatInputId: deviceId });
    void openInput(deviceId);
  };

  return (
    <Screen gap={24} padBottom={32}>
      <TopBar left="Capture a beat" right={<NavLink back to="/" onPress={() => closeInput()}>Back</NavLink>} />

      <Card>
        <View style={[s.row, { gap: 8 }]}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: live ? C.accent : C.dim }} />
          <Eyebrow accent={live}>{live ? 'Connected' : input.status === 'opening' ? 'Connecting' : 'Not connected'}</Eyebrow>
        </View>
        {live ? (
          <InputPanel input={input} onPick={pick} onPair={setPair} />
        ) : (
          <>
            <Txt size={30} w="display">
              Plug in your gear
            </Txt>
            <Muted>{input.error ?? 'Connect your MPC, sampler or audio interface by USB, then allow audio input when the browser asks.'}</Muted>
            <Btn label={input.status === 'opening' ? 'Connecting…' : input.error ? 'Try again' : 'Connect'} busy={input.status === 'opening'} onPress={() => void openInput(inputId)} />
          </>
        )}
      </Card>

      <View style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Arm recording"
          accessibilityState={{ disabled: !live }}
          disabled={!live}
          onPress={() => {
            wake();
            router.push('/record');
          }}
          style={({ pressed }) => ({ padding: 10, borderRadius: 100, backgroundColor: C.recHalo, opacity: live ? (pressed ? 0.85 : 1) : 0.35 })}
        >
          <View style={{ width: 148, height: 148, borderRadius: 74, backgroundColor: C.rec, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={22} w="display" ls={0} color={C.bg}>
              Arm
            </Txt>
          </View>
        </Pressable>
        <Muted size={15} center style={{ maxWidth: 260 }}>
          Arm, then press play on {gearName(live ? input.label : null)}. Recording starts when the beat does.
        </Muted>
      </View>

      <Muted size={13} center>
        Silence at the start and end is trimmed after capture.{live ? '' : ' No USB audio on your machine? Run its line out into any audio interface.'}
      </Muted>
    </Screen>
  );
}
