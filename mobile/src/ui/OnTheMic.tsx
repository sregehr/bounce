// Who is at the mic. Picking an artist starts a session: new songs and takes are theirs, with
// their name and the vocal sound saved for them, until someone else is picked.
import { useState } from 'react';
import { View } from 'react-native';

import { artistsIn, namesWithoutProfile, sessionArtist } from '@/data/artists';
import type { Project } from '@/data/model';
import { saveArtist, setSession, useLibrary } from '@/data/store';

import { Chip, Field, Muted, Txt, s } from './kit';
import { C } from './theme';

export function OnTheMic({ project, locked }: { project: Project; locked?: boolean }) {
  const library = useLibrary((l) => l);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const artists = artistsIn(library);
  const current = sessionArtist(library);
  const others = namesWithoutProfile(library).slice(0, 4);
  const pick = (id: string | null) => {
    setSession(id, project.id);
    setOpen(false);
    setName('');
  };
  const add = (called: string) => {
    const artist = saveArtist(called);
    if (artist) pick(artist.id);
  };
  // Their sound follows them: say so, so a changed mix is no surprise.
  const about = current
    ? project.artistId === current.id
      ? current.chain
        ? 'New takes are theirs, with the vocal sound saved for them.'
        : 'New takes are theirs. Save a vocal sound for them on the Mix page.'
      : `New takes are theirs. This song stays ${project.artist?.trim() || 'as it is'}.`
    : 'Pick who is recording, and new songs and takes carry their name and sound.';
  return (
    <View style={[{ gap: 10, paddingVertical: 4, borderTopWidth: 1, borderTopColor: C.line }, s.divided]}>
      <View style={[s.row, s.between, { minHeight: 48 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt size={15} w="semi">
            {current ? `On the mic: ${current.name}` : 'On the mic: no one picked'}
          </Txt>
          <Txt size={13} color={C.muted}>
            {about}
          </Txt>
        </View>
        {!locked && <Chip label={open ? 'Close' : current ? 'Change' : 'Pick'} onPress={() => setOpen(!open)} style={{ paddingHorizontal: 16, borderColor: C.text }} />}
      </View>
      {open && !locked && (
        <View style={{ gap: 10, paddingBottom: 6 }}>
          {(artists.length > 0 || others.length > 0) && (
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {artists.map((a) => (
                <Chip key={a.id} label={a.name} on={a.id === current?.id} onPress={() => pick(a.id)} />
              ))}
              {/* Names from earlier songs get a profile the first time they are picked. */}
              {others.map((n) => (
                <Chip key={n} label={n} onPress={() => add(n)} />
              ))}
              {current && <Chip label="No one" onPress={() => pick(null)} />}
            </View>
          )}
          <View style={[s.row, { gap: 8 }]}>
            <Field label="New artist name" value={name} onChangeText={setName} placeholder="Someone new? Their name" maxLength={40} autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => add(name)} style={{ flex: 1 }} />
            <Chip label="Add" onPress={() => add(name)} style={{ paddingHorizontal: 18, minHeight: 48, borderRadius: 14, opacity: name.trim() ? 1 : 0.35 }} />
          </View>
          {artists.length === 0 && others.length === 0 && <Muted size={13}>Each artist gets a profile, so their name and vocal sound are one tap away next time.</Muted>}
        </View>
      )}
    </View>
  );
}
