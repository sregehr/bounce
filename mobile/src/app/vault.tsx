import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { useBackup } from '@/data/backup';
import { CoverImage } from '@/cover/CoverImage';
import type { Project } from '@/data/model';
import { mixLead, songsIn } from '@/data/songs';
import { deleteProject, openSong, setCurrent, useLibrary } from '@/data/store';
import { Btn, Eyebrow, Field, Foot, Muted, NavLink, PlayIcon, Screen, TopBar, Txt, s } from '@/ui/kit';
import { C, clock, dayLabel, lufs } from '@/ui/theme';

const meta = (p: Project) => [dayLabel(p.saved?.at ?? p.createdAt), clock(p.stats?.durationSec ?? p.beat.durationSec), p.takes.length ? null : 'instrumental'].filter(Boolean).join(' · ');
const tag = (p: Project) => [p.overrides.master ? 'Mastered by hand' : `Mastered · ${p.master.style}`, p.stats ? lufs(p.stats.lufs, 0) : null, p.snippet.made ? 'Snippet made' : null, p.lyrics.trim() ? 'Has lyrics' : null].filter(Boolean).join(' · ');

/** Finished songs: the ones saved from a beat's song page, ready to play, share and promote. */
export default function Vault() {
  const library = useLibrary((l) => l);
  const backup = useBackup();
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const all = songsIn(library.projects);
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((p) => `${p.name} ${meta(p)} ${tag(p)} ${p.lyrics} ${p.snippet.caption}`.toLowerCase().includes(q)) : all;

  const open = (p: Project) => {
    openSong(p.id);
    router.push('/player');
  };
  const remove = (p: Project) => {
    if (removing !== p.id) return setRemoving(p.id);
    setRemoving(null);
    void deleteProject(p.id);
  };
  // With nothing finished yet, the Vault points at the step that gets a song here.
  const next = mixLead(library);
  const start = () => {
    if (next.id) setCurrent(next.id);
    router.push({ pathname: next.to, params: next.to === '/playback' ? { hint: 'finish' } : next.hint ? { hint: next.hint } : {} });
  };

  return (
    <Screen gap={16}>
      <TopBar left="Vault" />

      {all.length > 0 && (
        <View style={{ gap: 6 }}>
          <Eyebrow>Search your songs</Eyebrow>
          <Field label="Search your songs" value={query} onChangeText={setQuery} placeholder="A title, a style, a line" returnKeyType="search" autoCorrect={false} />
        </View>
      )}

      <View>
        {shown.map((p) => (
          <View key={p.id} style={[s.row, s.divided, { gap: 12, minHeight: 84 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${p.name}`} onPress={() => open(p)} style={[s.row, { flex: 1, gap: 14, minHeight: 84 }]}>
              <View>
                <CoverImage project={p} size={52} radius={10} />
                {library.songId === p.id && (
                  <View style={{ position: 'absolute', right: -6, bottom: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
                    <PlayIcon size={10} color={C.bg} />
                  </View>
                )}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Txt size={16} w="semi" numberOfLines={1}>
                  {p.name}
                </Txt>
                <Txt size={13} color={C.muted} numberOfLines={1}>
                  {meta(p)}
                </Txt>
                <Txt size={12} w="semi" color={C.accent} numberOfLines={1}>
                  {library.songId === p.id ? `In the player · ${tag(p)}` : tag(p)}
                </Txt>
              </View>
            </Pressable>
            <NavLink size={13} onPress={() => remove(p)} style={{ minHeight: 36 }}>
              {removing === p.id ? 'Sure?' : 'Remove'}
            </NavLink>
          </View>
        ))}
        {all.length === 0 ? (
          <View style={{ gap: 14, paddingVertical: 8 }}>
            <Txt size={22} w="display">
              Nothing finished yet
            </Txt>
            <Muted>The Vault holds your finished songs: the ones you want to play, share and promote. Takes stay with their beat until you finish one.</Muted>
            <Btn label={next.to === '/playback' ? 'Finish a song' : next.to === '/vocals' ? 'Record a take' : 'Add a beat'} onPress={start} style={{ flex: 0 }} />
          </View>
        ) : (
          shown.length === 0 && (
            <View style={{ paddingVertical: 20 }}>
              <Muted size={13}>{`Nothing in the vault matches “${query}”.`}</Muted>
            </View>
          )
        )}
      </View>

      <Foot gap={12}>
        <Muted size={13}>
          {all.length > 0 ? 'Removing a song here leaves its beat and takes where they are. ' : ''}
          {backup.status === 'done' ? 'Everything is backed up.' : backup.status === 'working' ? `Backing up${backup.pending ? ` (${backup.pending} left)` : ''}…` : backup.status === 'unreachable' ? 'Backup server not reachable; your work is safe on this device.' : backup.status === 'off' ? 'Backup is off.' : ''}
        </Muted>
      </Foot>
    </Screen>
  );
}
