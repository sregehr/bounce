import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useBackup } from '@/data/backup';
import { fileBase } from '@/data/exporting';
import { saveFiles } from '@/data/files';
import type { Project, Take } from '@/data/model';
import { deleteProject, deleteTake, patchProject, setCurrent, useLibrary } from '@/data/store';
import { getMix, loadPcm } from '@/data/studio';
import { encodeWav } from '@/dsp/wav';
import { Btn, Eyebrow, Field, Foot, Muted, NavLink, RoundPlay, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useTask } from '@/ui/hooks';
import { C, clock, dayLabel } from '@/ui/theme';

type Entry = { key: string; project: Project; take: Take | null; title: string; meta: string; tag: string; time: number; words: string };

function entries(projects: Project[]): Entry[] {
  const list: Entry[] = [];
  for (const project of projects) {
    if (project.takes.length === 0) {
      list.push({
        key: project.id,
        project,
        take: null,
        title: `${project.name} · beat`,
        meta: [dayLabel(project.createdAt), clock(project.beat.durationSec), project.stats ? project.master.style : null].filter(Boolean).join(' · '),
        tag: project.stats ? 'Mastered instrumental' : project.beat.source === 'capture' ? 'Captured' : project.beat.source === 'import' ? 'Imported' : 'Demo beat',
        time: project.createdAt,
        words: project.lyrics,
      });
    }
    for (const take of project.takes) {
      const active = project.takeId === take.id;
      list.push({
        key: take.id,
        project,
        take,
        title: `${project.name} · Take ${take.number}`,
        meta: [dayLabel(take.createdAt), clock(take.durationSec), project.polish.style].join(' · '),
        tag: active && project.snippet.made ? 'Snippet made' : take.origin === 'kept' ? 'Saved from the last 60 s' : take.origin === 'punched' ? 'Punched in' : active && project.lyrics.trim() ? 'Has lyrics' : active && project.stats ? 'Mastered' : 'Take',
        time: take.createdAt,
        words: active ? `${project.lyrics} ${project.snippet.caption}` : '',
      });
    }
  }
  return list.sort((a, b) => b.time - a.time);
}

export default function Vault() {
  const projects = useLibrary((l) => l.projects);
  const backup = useBackup();
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const stems = useTask();
  const [sent, setSent] = useState<string | null>(null);
  const all = entries(projects);
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((e) => `${e.title} ${e.meta} ${e.tag} ${e.words}`.toLowerCase().includes(q)) : all;
  const newest = all.find((e) => e.take);

  const open = (e: Entry) => {
    setCurrent(e.project.id);
    if (e.take && e.project.takeId !== e.take.id) patchProject(e.project.id, { takeId: e.take.id }, false);
    router.push('/player');
  };
  const remove = (e: Entry) => {
    if (removing !== e.key) return setRemoving(e.key);
    setRemoving(null);
    void (e.take ? deleteTake(e.project.id, e.take.id) : deleteProject(e.project.id));
  };
  /** The untouched parts an engineer would want: the beat, the raw vocal, and the processed vocal. */
  const sendStems = () =>
    newest?.take &&
    stems.run(async () => {
      const project = { ...newest.project, takeId: newest.take!.id };
      const base = fileBase(`${project.name} take ${newest.take!.number}`);
      const beat = await loadPcm(project.beat.key);
      const raw = await loadPcm(newest.take!.key);
      const vocals = await getMix(project, { include: 'vocals' });
      await saveFiles(
        [
        { name: `${base} - beat.wav`, data: encodeWav(beat.channels, beat.sampleRate, 24), type: 'audio/wav' },
        { name: `${base} - vocal raw.wav`, data: encodeWav(raw.channels, raw.sampleRate, 24), type: 'audio/wav' },
        { name: `${base} - vocal processed.wav`, data: encodeWav(vocals.channels, vocals.sampleRate, 24), type: 'audio/wav' },
        ],
        `${base} stems`,
      );
      setSent(`Saved ${base} stems.zip to your downloads: the beat, the raw vocal and the processed vocal.`);
    });

  return (
    <Screen gap={16}>
      <TopBar left="Vault" right={<NavLink home>Home</NavLink>} />

      <View style={{ gap: 6 }}>
        <Eyebrow>Search your bars</Eyebrow>
        <Field label="Search your bars" value={query} onChangeText={setQuery} placeholder="A word, a beat, a name" returnKeyType="search" autoCorrect={false} />
      </View>

      <View>
        {shown.map((e) => (
          <View key={e.key} style={[s.row, s.divided, { gap: 14, minHeight: 84 }]}>
            <RoundPlay label={`Play ${e.title}`} onPress={() => open(e)} />
            <View style={{ flex: 1, gap: 3 }}>
              <Txt size={16} w="semi" numberOfLines={1}>
                {e.title}
              </Txt>
              <Txt size={13} color={C.muted}>
                {e.meta}
              </Txt>
              <Txt size={12} w="semi" color={C.accent}>
                {e.tag}
              </Txt>
            </View>
            <NavLink size={13} onPress={() => remove(e)} style={{ minHeight: 36 }}>
              {removing === e.key ? 'Sure?' : 'Remove'}
            </NavLink>
          </View>
        ))}
        {shown.length === 0 && (
          <View style={{ paddingVertical: 20 }}>
            <Muted size={13}>{all.length === 0 ? 'Nothing here yet. Every take you record is kept in the vault.' : `Nothing in the vault matches “${query}”.`}</Muted>
          </View>
        )}
      </View>

      <Foot gap={12}>
        <Muted size={13}>
          Search covers beat names, styles and any lyrics you have added in the player.{' '}
          {backup.status === 'done' ? 'Everything is backed up.' : backup.status === 'working' ? `Backing up${backup.pending ? ` (${backup.pending} left)` : ''}…` : backup.status === 'unreachable' ? 'Backup server not reachable; your work is safe on this device.' : backup.status === 'off' ? 'Backup is off.' : ''}
        </Muted>
        {(stems.error || sent) && (
          <Txt size={13} color={stems.error ? C.recText : C.muted}>
            {stems.error ?? sent}
          </Txt>
        )}
        <Btn kind="outline" label={newest ? 'Send stems to an engineer' : 'Record a take to send stems'} disabled={!newest} busy={stems.busy} onPress={sendStems} style={{ flex: 0 }} />
      </Foot>
    </Screen>
  );
}
