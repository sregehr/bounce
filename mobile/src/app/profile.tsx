import { View } from 'react-native';

import { AccountPanel } from '@/auth/account';
import { backendAvailable } from '@/auth/backend';
import { setProfile, useLibrary } from '@/data/store';
import { Eyebrow, Field, Muted, Screen, TopBar } from '@/ui/kit';
import { Columns, useWide } from '@/ui/wide';

import { SettingsBody } from './settings';

/** The sections of the Profile screen, for it and for the wide page it shares with Settings. */
export function ProfileBody() {
  const artist = useLibrary((l) => l.profile.artist);
  return (
    <>
      <View style={{ gap: 8 }}>
        <Eyebrow>Your name</Eyebrow>
        <Field label="Artist name" value={artist} onChangeText={(name) => setProfile({ artist: name })} placeholder="Artist name" maxLength={40} autoCapitalize="words" />
        <Muted size={13}>Used on a song when no other artist is named on it.</Muted>
      </View>

      {backendAvailable && (
        <View style={{ gap: 8 }}>
          <Eyebrow>Account</Eyebrow>
          <AccountPanel returnTo="/profile" />
        </View>
      )}
    </>
  );
}

/** Who you are: the name that goes on your songs, and the account you are signed in with. */
export default function Profile() {
  // Wide: there is room for Settings beside it, so the two are one page.
  if (useWide())
    return (
      <Screen>
        <Columns
          gap={56}
          inner={18}
          left={
            <>
              <TopBar left="Profile" />
              <ProfileBody />
            </>
          }
          right={
            <>
              <TopBar left="Settings" />
              <SettingsBody />
            </>
          }
        />
      </Screen>
    );

  return (
    <Screen gap={18} padBottom={40}>
      <TopBar left="Profile" />

      <ProfileBody />
    </Screen>
  );
}
