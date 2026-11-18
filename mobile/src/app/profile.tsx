import { useState } from 'react';
import { View } from 'react-native';

import { AccountPanel } from '@/auth/account';
import { backendAvailable } from '@/auth/backend';
import { artistsIn } from '@/data/artists';
import type { Artist } from '@/data/model';
import { removeArtist, renameArtist, saveArtist, setArtistSound, setProfile, useLibrary } from '@/data/store';
import { useArmed } from '@/ui/hooks';
import { Chip, Eyebrow, Field, Muted, NavLink, Screen, TopBar, Txt, s } from '@/ui/kit';
import { C, plural } from '@/ui/theme';
import { Columns, useWide } from '@/ui/wide';

import { SettingsBody } from './settings';

/** One artist's profile: their name, the vocal sound kept for them, and the way to remove them. */
function ArtistRow({ artist, songs }: { artist: Artist; songs: number }) {
  const [armed, arm] = useArmed(4000);
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border }}>
      <Field label={`Name of ${artist.name || 'artist'}`} value={artist.name} onChangeText={(name) => renameArtist(artist.id, name)} onBlur={() => !artist.name.trim() && renameArtist(artist.id, 'Artist')} placeholder="Artist name" maxLength={40} autoCapitalize="words" />
      <Txt size={13} color={C.muted}>
        {`${songs ? plural(songs, 'song') : 'No songs yet'} · ${artist.chain ? `Vocal sound saved${artist.style ? `, ${artist.style.toLowerCase()}` : ''}` : 'No vocal sound saved yet. Save one from the Mix page of a song of theirs.'}`}
      </Txt>
      <View style={[s.row, { gap: 16, flexWrap: 'wrap' }]}>
        {artist.chain && (
          <NavLink size={14} onPress={() => setArtistSound(artist.id, undefined)}>
            Forget their vocal sound
          </NavLink>
        )}
        <NavLink size={14} onPress={() => (armed ? removeArtist(artist.id) : arm())}>
          {armed ? `Tap again to remove ${artist.name}` : 'Remove this artist'}
        </NavLink>
      </View>
    </View>
  );
}

/** The sections of the Profile screen, for it and for the wide page it shares with Settings. */
export function ProfileBody() {
  const artist = useLibrary((l) => l.profile.artist);
  const library = useLibrary((l) => l);
  const artists = artistsIn(library);
  const [name, setName] = useState('');
  const add = () => saveArtist(name) && setName('');
  return (
    <>
      <View style={{ gap: 8 }}>
        <Eyebrow>Your name</Eyebrow>
        <Field label="Artist name" value={artist} onChangeText={(name) => setProfile({ artist: name })} placeholder="Artist name" maxLength={40} autoCapitalize="words" />
        <Muted size={13}>Used on a song when no other artist is named on it.</Muted>
      </View>

      <View style={{ gap: 10 }}>
        <Eyebrow>Artists you record</Eyebrow>
        <Muted size={13}>Each artist keeps their name and the vocal sound that suits them. Pick who is on the mic from the mic screen, and their songs and takes pick both up. Removing an artist leaves their songs as they are.</Muted>
        {artists.map((a) => (
          <ArtistRow key={a.id} artist={a} songs={library.projects.filter((p) => p.artistId === a.id).length} />
        ))}
        <View style={[s.row, { gap: 8 }]}>
          <Field label="Add an artist" value={name} onChangeText={setName} placeholder="Add an artist by name" maxLength={40} autoCapitalize="words" returnKeyType="done" onSubmitEditing={add} style={{ flex: 1 }} />
          <Chip label="Add artist" onPress={add} style={{ paddingHorizontal: 16, minHeight: 48, borderRadius: 14, opacity: name.trim() ? 1 : 0.35 }} />
        </View>
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
