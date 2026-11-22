import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Redirect, router } from 'expo-router';

import { backupAvailable, backupNow, eraseBackup, restoreBackup, restoreCode, useBackup } from '@/data/backup';
import { blobs, kv } from '@/data/db';
import { storageEstimate } from '@/data/files';
import { emptyLibrary } from '@/data/model';
import { getLibrary, setProfile, setSettings, update, useLibrary } from '@/data/store';
import { closeInput, stopTransport, useEngine } from '@/engine/engine';
import { MicSetup } from '@/ui/MicSetup';
import { Btn, Disclosure, Eyebrow, Field, Muted, NavLink, Option, RowLink, Screen, TopBar, Txt } from '@/ui/kit';
import { useTiming } from '@/ui/timing';
import { useArmed, useTask } from '@/ui/hooks';
import { C, plural } from '@/ui/theme';
import { useWide } from '@/ui/wide';


const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** The sections of the Settings screen, for it and for the wide page it shares with Profile. */
export function SettingsBody() {
  const settings = useLibrary((l) => l.settings);
  const count = useLibrary((l) => l.projects.length);
  const backup = useBackup();
  const [space, setSpace] = useState<{ used: number; quota: number } | null>(null);
  const [armed, arm] = useArmed(4000);
  const input = useEngine((e) => e.input);
  const timing = useTiming();

  useEffect(() => {
    void storageEstimate().then(setSpace);
  }, [count]);

  // Moving to another device: this one shows a code, the other one types it in.
  const [code, setCode] = useState<string | null>(null);
  const [entered, setEntered] = useState('');
  const [restored, setRestored] = useState<string | null>(null);
  const restoring = useTask();
  const restore = () =>
    restoring.run(async () => {
      setRestored(null);
      const added = await restoreBackup(entered, (left) => setRestored(left ? `Downloading: ${plural(left, 'file')} to go…` : 'Finishing…'));
      setRestored(added ? `${plural(added, 'song')} restored. They are on Home and in the Vault.` : 'Everything in that backup is already on this device.');
      setEntered('');
    });

  const wipe = async () => {
    if (!armed) return arm();
    stopTransport();
    closeInput();
    // The copy on the backup server goes too. If the server cannot be reached now, the request
    // is kept and sent the next time the app is online.
    const { deviceId, deviceSecret } = getLibrary().settings;
    await eraseBackup({ deviceId, secret: deviceSecret });
    for (const key of await blobs.keys()) await blobs.delete(key).catch(() => {});
    await kv.set('backup', {}).catch(() => {});
    update(() => emptyLibrary());
    router.replace('/onboarding');
  };

  // Each group is rows that say what is set now; a row opens its detail in place.
  const [open, setOpen] = useState<'mic' | 'timing' | 'move' | null>(null);
  const toggle = (row: 'mic' | 'timing' | 'move') => setOpen(open === row ? null : row);
  const backedUp = !settings.backup
    ? 'Off. Everything stays only on this device.'
    : backup.status === 'working'
      ? `Backing up${backup.pending ? `: ${plural(backup.pending, 'file')} to go` : ''}…`
      : backup.status === 'unreachable'
        ? 'The backup server cannot be reached. It will keep trying.'
        : backup.status === 'full'
          ? 'The backup is full, so newer work is only on this device. Delete songs you no longer need to make room.'
          : backup.status === 'done' && backup.skipped
            ? `Backed up, except ${plural(backup.skipped, 'file')} too big to back up.`
            : backup.status === 'done'
              ? 'Everything is backed up.'
              : 'Waiting for changes.';

  return (
    <>
      {/* Which microphone records, and how far takes are moved to land on the beat. Both are set once for the device. The microphone is only opened when asked for here. */}
      <View>
        <View style={{ paddingBottom: 8 }}>
          <Eyebrow>Recording</Eyebrow>
        </View>
        <Disclosure title="Microphone" summary={input.status === 'ready' ? (input.label ?? 'Connected') : 'Not connected'} open={open === 'mic'} onToggle={() => toggle('mic')}>
          <View style={{ paddingTop: 4 }}>
            <MicSetup part="mic" />
          </View>
        </Disclosure>
        <Disclosure title="Timing" summary={`${timing.ms} ms · ${timing.measured ? 'measured' : 'estimated'} for this setup`} open={open === 'timing'} onToggle={() => toggle('timing')} last>
          <View style={{ paddingTop: 4 }}>
            <MicSetup part="timing" />
          </View>
        </Disclosure>
      </View>

      <View>
        <View style={{ paddingBottom: 4 }}>
          <Eyebrow>Backup</Eyebrow>
        </View>
        {backupAvailable ? (
          <>
            <Option label="Back up my beats and takes" sub={backedUp} checked={settings.backup} onChange={(on) => (setSettings({ backup: on }), setTimeout(backupNow, 400))} minHeight={56} />
            <Muted size={13} style={{ paddingBottom: 10 }}>
              Backup copies your library to the Bounce server. Signing in puts your account on it.
            </Muted>
            <Disclosure title="Move to another device" summary="With a restore code" open={open === 'move'} onToggle={() => toggle('move')} last>
              <View style={{ gap: 10, paddingTop: 4, paddingBottom: 12 }}>
                <Muted size={13}>Show a restore code here, then enter it on the other device to bring your songs across. Anyone with the code can read your backup, so keep it to yourself.</Muted>
                {code ? (
                  <View style={{ gap: 8 }}>
                    <Field label="Restore code" value={code} editable={false} selectTextOnFocus multiline style={{ fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, fontSize: 13 }} />
                    <NavLink size={14} tone="quiet" onPress={() => setCode(null)}>
                      Hide the code
                    </NavLink>
                  </View>
                ) : (
                  <NavLink size={14} onPress={() => (backupNow(), setCode(restoreCode()))}>
                    Show this device's restore code
                  </NavLink>
                )}
                <Field label="Restore code from another device" value={entered} onChangeText={setEntered} placeholder="Paste a restore code" autoCapitalize="none" autoCorrect={false} returnKeyType="done" />
                {entered.trim() ? <Btn label="Restore from this code" busy={restoring.busy} onPress={restore} style={{ flexGrow: 0 }} /> : null}
                {(restoring.error || restored) && (
                  <Txt size={13} color={restoring.error ? C.recText : C.muted}>
                    {restoring.error ?? restored}
                  </Txt>
                )}
              </View>
            </Disclosure>
          </>
        ) : (
          <Muted size={13}>No backup server is configured for this build. Everything is saved on this device.</Muted>
        )}
      </View>

      <View>
        <View style={{ paddingBottom: 8 }}>
          <Eyebrow>This device</Eyebrow>
        </View>
        <View style={{ gap: 2, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <Txt size={15} w="semi">
            Storage
          </Txt>
          <Muted size={13}>
            {plural(count, 'beat')} saved here{space ? `, using ${mb(space.used)} of about ${mb(space.quota)} this browser allows` : ''}. Clearing this browser's site data deletes them.
          </Muted>
        </View>
        <RowLink title="Privacy" to="/privacy" />
        <RowLink title="Show the welcome again" onPress={() => (setProfile({ onboarded: false }), router.replace('/onboarding'))} />
        {/* Destructive, so it looks it: red and set apart from the rows above, with a second tap to confirm, since nothing brings it back. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={armed ? 'Tap again to delete every beat, take and cover on this device' : 'Delete everything on this device'}
          onPress={() => void wipe()}
          style={({ pressed }) => ({ marginTop: 20, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: C.rec, backgroundColor: armed ? C.rec : 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}
        >
          <Txt size={15} w="semi" color={armed ? C.text : C.recText} center>
            {armed ? `Tap again: this deletes every beat, take and cover here${backupAvailable ? ' and in your backup' : ''}` : 'Delete everything on this device'}
          </Txt>
        </Pressable>
      </View>
    </>
  );
}

export default function Settings() {
  // Wide: Profile and Settings are one page, whichever of the two was asked for.
  if (useWide()) return <Redirect href="/profile" />;

  return (
    <Screen gap={18} padBottom={40}>
      <TopBar left="Settings" />

      <SettingsBody />
    </Screen>
  );
}
