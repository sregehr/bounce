import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { backupAvailable, backupNow, useBackup } from '@/data/backup';
import { blobs, kv } from '@/data/db';
import { storageEstimate } from '@/data/files';
import { emptyLibrary } from '@/data/model';
import { setProfile, setSettings, update, useLibrary } from '@/data/store';
import { closeInput, measureLatency, openInput, reportedLatencyMs, setPair, stopTransport, useEngine } from '@/engine/engine';
import { Btn, Card, Chip, Eyebrow, Field, Muted, NavLink, Option, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useArmed, useTask } from '@/ui/hooks';
import { InputPanel, TapCheck, type TapOutcome } from '@/ui/parts';
import { C, plural } from '@/ui/theme';

const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

export default function Settings() {
  const profile = useLibrary((l) => l.profile);
  const settings = useLibrary((l) => l.settings);
  const count = useLibrary((l) => l.projects.length);
  const input = useEngine((e) => e.input);
  const backup = useBackup();
  const check = useTask();
  const [heard, setHeard] = useState<string | null>(null);
  const [tapping, setTapping] = useState(false);
  const [space, setSpace] = useState<{ used: number; quota: number } | null>(null);
  const [armed, arm] = useArmed(4000);
  const live = input.status === 'ready';
  const latency = settings.latencyMs ?? reportedLatencyMs();

  useEffect(() => {
    void storageEstimate().then(setSpace);
  }, [count]);

  const runCheck = () =>
    check.run(async () => {
      const result = await measureLatency();
      if (result.medianMs === null) {
        setHeard(`Only ${result.detected} of 6 clicks came back, so nothing was changed. Turn the volume up, or hold one ear cup to the mic.`);
        return;
      }
      setSettings({ latencyMs: Math.round(result.medianMs) });
      setHeard(`Measured ${Math.round(result.medianMs)} ms from ${result.detected} clicks.`);
    });

  const tapped = (outcome: TapOutcome) => {
    setTapping(false);
    if (outcome.ms === null) {
      setHeard(`Only ${outcome.matched} of ${outcome.clicks} taps lined up, so nothing was changed. Try again, tapping right on each click.`);
      return;
    }
    setSettings({ latencyMs: Math.min(500, outcome.ms) });
    setHeard(`Measured ${Math.min(500, outcome.ms)} ms from ${outcome.matched} taps. Nudge it with −5 and +5 if takes still sit early or late.`);
  };

  const wipe = async () => {
    if (!armed) return arm();
    stopTransport();
    closeInput();
    for (const key of await blobs.keys()) await blobs.delete(key).catch(() => {});
    await kv.set('backup', {}).catch(() => {});
    update(() => emptyLibrary());
    router.replace('/onboarding');
  };

  return (
    <Screen gap={18} padBottom={40}>
      <TopBar left="Settings" />

      <View style={{ gap: 8 }}>
        <Eyebrow>Names</Eyebrow>
        <Field label="Artist name" value={profile.artist} onChangeText={(artist) => setProfile({ artist })} placeholder="Artist name" maxLength={40} />
        <Field label="Producer name" value={profile.producer} onChangeText={(producer) => setProfile({ producer })} placeholder="Producer (optional)" maxLength={40} />
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>Input</Eyebrow>
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
              <Muted>{input.error ?? 'Connect to choose which input Bounce records from and to see its level.'}</Muted>
              <Btn kind="outline" label="Connect an input" busy={input.status === 'opening'} onPress={() => void openInput(settings.inputId, 'mic')} style={{ flex: 0 }} />
            </>
          )}
        </Card>
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>Timing</Eyebrow>
        <View style={[s.row, s.between]}>
          <View style={{ gap: 2, flex: 1 }}>
            <Txt size={24} w="display" ls={0}>
              {latency} ms
            </Txt>
            <Muted size={13}>{settings.latencyMs !== null ? 'Measured on this setup. New takes are moved this much earlier.' : "The browser's estimate. Run the check for an exact figure."}</Muted>
          </View>
          <View style={[s.row, { gap: 6 }]}>
            <Chip label="−5" onPress={() => setSettings({ latencyMs: Math.max(0, latency - 5) })} style={{ paddingHorizontal: 12 }} />
            <Chip label="+5" onPress={() => setSettings({ latencyMs: Math.min(500, latency + 5) })} style={{ paddingHorizontal: 12 }} />
          </View>
        </View>
        {(check.error || heard) && (
          <Txt size={13} color={check.error ? C.recText : C.muted}>
            {check.error ?? heard}
          </Txt>
        )}
        {tapping ? (
          <Card style={{ padding: 16 }}>
            <TapCheck onDone={tapped} onCancel={() => setTapping(false)} />
          </Card>
        ) : (
          <>
            <View style={[s.row, { gap: 10 }]}>
              <Btn kind="outline" label="Play the clicks" busy={check.busy} disabled={!live} onPress={runCheck} style={{ flex: 1 }} />
              <Btn kind="outline" label="Tap along" disabled={!live || check.busy} onPress={() => (setHeard(null), setTapping(true))} style={{ flex: 1 }} />
            </View>
            {live ? (
              <Muted size={13}>Wearing earbuds? The mic cannot hear the clicks through them, so tap along instead.</Muted>
            ) : (
              <Muted size={13}>Connect an input above to run a check.</Muted>
            )}
            {settings.latencyMs !== null && (
              <NavLink size={14} onPress={() => (setSettings({ latencyMs: null }), setHeard(null))}>
                Use the estimate
              </NavLink>
            )}
          </>
        )}
      </View>

      <View style={{ gap: 4 }}>
        <Eyebrow>Backup</Eyebrow>
        {backupAvailable ? (
          <>
            <Option
              label="Back up my beats and takes"
              sub={
                !settings.backup
                  ? 'Off. Everything stays only on this device.'
                  : backup.status === 'working'
                    ? `Backing up${backup.pending ? `: ${plural(backup.pending, 'file')} to go` : ''}…`
                    : backup.status === 'unreachable'
                      ? 'The backup server cannot be reached. It will keep trying.'
                      : backup.status === 'done'
                        ? 'Everything is backed up.'
                        : 'Waiting for changes.'
              }
              checked={settings.backup}
              onChange={(on) => (setSettings({ backup: on }), setTimeout(backupNow, 400))}
              minHeight={56}
            />
            <Muted size={13}>Backup copies your library to the Bounce server. There are no accounts yet, so it cannot be restored onto another device.</Muted>
          </>
        ) : (
          <Muted size={13}>No backup server is configured for this build. Everything is saved on this device.</Muted>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>This device</Eyebrow>
        <Muted size={13}>
          {plural(count, 'beat')} saved here{space ? `, using ${mb(space.used)} of about ${mb(space.quota)} this browser allows` : ''}. Clearing this browser's site data deletes them.
        </Muted>
        <NavLink size={14} onPress={() => (setProfile({ onboarded: false }), router.replace('/onboarding'))}>
          Show the welcome again
        </NavLink>
        <NavLink size={14} onPress={() => void wipe()}>
          {armed ? 'Tap again: this deletes every beat, take and cover here' : 'Delete everything on this device'}
        </NavLink>
      </View>
    </Screen>
  );
}
