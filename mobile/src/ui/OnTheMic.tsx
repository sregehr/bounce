// Who is at the mic. Naming an artist starts a session: new songs and takes are theirs, with
// their name and the vocal sound saved for them, until the name is changed.
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { recentArtists, sessionArtist } from '@/data/artists';
import type { Project } from '@/data/model';
import { saveArtist, setSession, useLibrary } from '@/data/store';

import { Chip, Field, Txt, s } from './kit';
import { C } from './theme';

export function OnTheMic({ project, locked }: { project: Project; locked?: boolean }) {
  const library = useLibrary((l) => l);
  const current = sessionArtist(library);
  const recent = recentArtists(library);
  // The name as it is being typed. It takes effect when the field is left, so a half-typed name is nobody.
  const [name, setName] = useState(current?.name ?? '');
  useEffect(() => setName(current?.name ?? ''), [current?.id, current?.name]);

  const settle = (called: string) => {
    const trimmed = called.trim();
    if (trimmed.toLowerCase() === (current?.name ?? '').toLowerCase()) return;
    setSession(trimmed ? (saveArtist(trimmed)?.id ?? null) : null, project.id);
  };
  // Leaving the page with a name still in the field counts as leaving the field.
  const latest = useRef({ name, settle });
  latest.current = { name, settle };
  useEffect(() => () => latest.current.settle(latest.current.name), []);

  // Their sound follows them: say so, so a changed mix is no surprise.
  const about = current
    ? project.artistId === current.id
      ? current.chain
        ? 'New takes are theirs, with the vocal sound saved for them.'
        : 'New takes are theirs. Save a vocal sound for them on the Mix page.'
      : `New takes are theirs. This song stays ${project.artist?.trim() || 'as it is'}.`
    : 'Type who is recording, and new songs and takes carry their name and sound.';
  return (
    <View style={[{ gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }, s.divided]}>
      <View style={{ gap: 2 }}>
        <Txt size={15} w="semi">
          {current ? `On the mic: ${current.name}` : 'On the mic: no one yet'}
        </Txt>
        <Txt size={13} color={C.muted}>
          {about}
        </Txt>
      </View>
      {!locked && (
        <>
          <Field label="Who is on the mic" value={name} onChangeText={setName} onBlur={() => settle(name)} onSubmitEditing={() => settle(name)} placeholder="Artist name" maxLength={40} autoCapitalize="words" returnKeyType="done" />
          {/* The last few people recorded here: a tap puts their name in the field. */}
          {recent.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4 }}>
              {recent.map((n) => (
                <Chip key={n} label={n} on={n.toLowerCase() === name.trim().toLowerCase()} onPress={() => (setName(n), settle(n))} />
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}
