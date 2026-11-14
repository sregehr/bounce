import { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';

import { exportFiles, LOUDNESS } from '@/data/exporting';
import { canShareFiles, saveFiles, shareFiles } from '@/data/files';
import type { ExportChoice } from '@/data/model';
import { activeTake, patchProject, useProject } from '@/data/store';
import { useSong } from '@/data/song';
import { Btn, Card, Eyebrow, Foot, Muted, NavLink, Option, RoundPlay, Screen, TopBar, Txt } from '@/ui/kit';
import { useStopOnLeave, useTask } from '@/ui/hooks';
import { C, clock, lufs, plural } from '@/ui/theme';

export default function Export() {
  const project = useProject();
  const take = activeTake(project);
  const choice = project?.exporting;
  // What plays here is what will be exported, at the chosen loudness.
  const song = useSong(project, { autoplay: false, mix: choice ? { targetLufs: LOUDNESS[choice.loudness] } : undefined });
  const task = useTask();
  const [stage, setStage] = useState('');
  const [done, setDone] = useState<string | null>(null);
  useStopOnLeave();

  if (!project || !choice) return <Redirect href="/" />;

  const set = (patch: Partial<ExportChoice>) => (setDone(null), patchProject(project.id, { exporting: { ...choice, ...patch } }, false));
  const count = (take ? 1 : 0) + (!take || choice.instrumental ? 1 : 0) + (take && choice.vocals ? 1 : 0);
  const run = (how: 'share' | 'save') =>
    task.run(async () => {
      setDone(null);
      song.pause();
      const files = await exportFiles(project, setStage);
      setStage('');
      if (how === 'save') {
        const saved = await saveFiles(files, project.name);
        setDone(files.length === 1 ? `Saved ${saved} to your downloads.` : `${plural(files.length, 'file')} saved to your downloads as ${saved}.`);
      } else {
        const result = await shareFiles(files, project.name);
        setDone(result === 'shared' ? 'Shared.' : result === 'saved' ? `This browser has no share sheet for audio, so ${files.length === 1 ? 'the file was' : 'a ZIP of the files was'} saved to your downloads instead.` : null);
      }
    });
  const asMastered = project.stats ? lufs(project.stats.lufs) : 'as it is';

  return (
    <Screen>
      <TopBar left="Export" right={<NavLink to="/master" back>Back</NavLink>} />

      <Card style={{ borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Txt size={16} w="semi" numberOfLines={1}>
            {project.name}
          </Txt>
          <Txt size={13} color={C.muted}>
            {[clock(song.mix?.durationSec ?? project.stats?.durationSec ?? project.beat.durationSec), take ? 'beat and vocals' : 'beat only', project.overrides.master ? 'set by hand' : project.master.style, song.mix ? lufs(song.mix.lufs) : null].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <RoundPlay playing={song.t.playing} onPress={song.toggle} disabled={!song.t.loaded} />
      </Card>

      <View>
        <View style={{ paddingBottom: 4 }}>
          <Eyebrow>Loudness</Eyebrow>
        </View>
        <Option radio boxFirst divided label="Streaming" hint="−14 LUFS" checked={choice.loudness === 'streaming'} onChange={() => set({ loudness: 'streaming' })} />
        <Option radio boxFirst divided label="Loud, for socials and demos" hint="−9 LUFS" checked={choice.loudness === 'loud'} onChange={() => set({ loudness: 'loud' })} />
        <Option radio boxFirst label="Keep as mastered" hint={asMastered} checked={choice.loudness === 'mastered'} onChange={() => set({ loudness: 'mastered' })} />
      </View>

      <View>
        <View style={{ paddingBottom: 4 }}>
          <Eyebrow>Format</Eyebrow>
        </View>
        <Option radio boxFirst divided label="WAV, 24-bit" hint="Full quality" checked={choice.format === 'wav24'} onChange={() => set({ format: 'wav24' })} />
        <Option radio boxFirst label="WAV, 16-bit" hint="Smaller · plays anywhere" checked={choice.format === 'wav16'} onChange={() => set({ format: 'wav16' })} />
      </View>

      {take && (
        <View>
          <View style={{ paddingBottom: 4 }}>
            <Eyebrow>Also include</Eyebrow>
          </View>
          <Option boxFirst label="Instrumental, mastered to match" checked={choice.instrumental} onChange={(instrumental) => set({ instrumental })} />
          <Option boxFirst label="Vocals only" checked={choice.vocals} onChange={(vocals) => set({ vocals })} />
        </View>
      )}

      <Foot>
        {(task.error || done || task.busy) && (
          <Txt size={13} color={task.error ? C.recText : C.muted} center>
            {task.error ?? (task.busy ? `${stage || 'Working'}…` : done)}
          </Txt>
        )}
        <Btn label={canShareFiles() ? 'Share' : `Save ${plural(count, 'file')}`} busy={task.busy} onPress={() => run(canShareFiles() ? 'share' : 'save')} />
        {canShareFiles() && <Btn kind="outline" label="Save to Files" size={16} disabled={task.busy} onPress={() => run('save')} style={{ flex: 0 }} />}
        <NavLink to="/cover" center>
          Add cover art and play it
        </NavLink>
        <Muted size={12} center>
          M4A export comes with the phone app; browsers cannot encode it reliably.
        </Muted>
      </Foot>
    </Screen>
  );
}
