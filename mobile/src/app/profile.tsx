import { View } from 'react-native';

import { AccountPanel } from '@/auth/account';
import { backendAvailable } from '@/auth/backend';
import { setProfile, useLibrary } from '@/data/store';
import { Eyebrow, Field, Muted, Screen, TopBar } from '@/ui/kit';

/** Who you are: the name that goes on your songs, and the account you are signed in with. */
export default function Profile() {
  const artist = useLibrary((l) => l.profile.artist);
  return (
    <Screen gap={18} padBottom={40}>
      <TopBar left="Profile" />

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
    </Screen>
  );
}
