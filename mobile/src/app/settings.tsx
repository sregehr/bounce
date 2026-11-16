import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { backupAvailable, backupNow, useBackup } from '@/data/backup';
import { blobs, kv } from '@/data/db';
import { storageEstimate } from '@/data/files';
import { emptyLibrary } from '@/data/model';
import { setProfile, setSettings, update, useLibrary } from '@/data/store';
import { closeInput, stopTransport } from '@/engine/engine';
import { Eyebrow, Muted, NavLink, Option, Screen, TopBar } from '@/ui/kit';
import { useArmed } from '@/ui/hooks';
import { plural } from '@/ui/theme';
import { useWide } from '@/ui/wide';

import Profile from './profile';

const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** The sections of the Settings screen, for it and for the wide page it shares with Profile. */
export function SettingsBody() {
  const settings = useLibrary((l) => l.settings);
  const count = useLibrary((l) => l.projects.length);
  const backup = useBackup();
  const [space, setSpace] = useState<{ used: number; quota: number } | null>(null);
  const [armed, arm] = useArmed(4000);

  useEffect(() => {
    void storageEstimate().then(setSpace);
  }, [count]);

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
    <>
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
            <Muted size={13}>Backup copies your library to the Bounce server. Signing in puts your account on it; restoring onto another device is not built yet.</Muted>
          </>
        ) : (
          <Muted size={13}>No backup server is configured for this build. Everything is saved on this device.</Muted>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>Storage</Eyebrow>
        <Muted size={13}>
          {plural(count, 'beat')} saved here{space ? `, using ${mb(space.used)} of about ${mb(space.quota)} this browser allows` : ''}. Clearing this browser's site data deletes them.
        </Muted>
        <NavLink size={14} onPress={() => (setProfile({ onboarded: false }), router.replace('/onboarding'))}>
          Show the welcome again
        </NavLink>
        <NavLink size={14} to="/privacy">
          Privacy
        </NavLink>
        <NavLink size={14} onPress={() => void wipe()}>
          {armed ? 'Tap again: this deletes every beat, take and cover here' : 'Delete everything on this device'}
        </NavLink>
      </View>
    </>
  );
}

export default function Settings() {
  // Wide: Profile and Settings are one page, whichever of the two was asked for.
  if (useWide()) return <Profile />;

  return (
    <Screen gap={18} padBottom={40}>
      <TopBar left="Settings" />

      <SettingsBody />
    </Screen>
  );
}
