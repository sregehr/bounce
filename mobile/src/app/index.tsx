import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { importBeat } from '@/data/beats';
import { CoverImage } from '@/cover/CoverImage';
import { tempoLine } from '@/data/labels';
import type { Project } from '@/data/model';
import { setCurrent, useLibrary, useSaveError } from '@/data/store';
import { loopSeconds } from '@/data/studio';
import { Btn, Eyebrow, Foot, MicIcon, Muted, NavLink, PlayIcon, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useTask } from '@/ui/hooks';
import { C, plural } from '@/ui/theme';

function loopLine(p: Project) {
  const loop = loopSeconds(p.beat, p.loop);
  return loop ? `bars ${loop.startBar + 1}–${loop.startBar + loop.bars} on loop` : 'whole beat';
}

export default function Home() {
  const projects = useLibrary((l) => l.projects);
  const saveError = useSaveError();
  const task = useTask();
  const latest = projects[0];
  const playable = projects.find((p) => p.takes.length > 0 || p.stats);

  const open = (p: Project, to: '/vocals' | '/player' | '/beat') => {
    setCurrent(p.id);
    router.push(to);
  };
  const add = (work: () => Promise<Project | null>) => task.run(async () => void ((await work()) && router.push('/beat')));

  return (
    <Screen gap={20}>
      <TopBar
        left={
          <Txt size={22} w="display">
            Bounce
          </Txt>
        }
      />

      {latest ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Freestyle over ${latest.name}`} onPress={() => open(latest, '/vocals')} style={({ pressed }) => ({ backgroundColor: C.accent, borderRadius: 28, padding: 24, gap: 18, opacity: pressed ? 0.9 : 1 })}>
          <View style={[s.row, s.between, { alignItems: 'flex-start' }]}>
            <View style={{ gap: 6, flex: 1 }}>
              <Txt size={12} w="semi" ls={0.1} color={C.bg}>
                FREESTYLE OVER
              </Txt>
              <Txt size={38} w="display" ls={-0.03} lh={1} color={C.bg} numberOfLines={2}>
                {latest.name}
              </Txt>
            </View>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
              <MicIcon />
            </View>
          </View>
          <Txt size={15} w="medium" lh={1.4} color={C.bg}>
            {[tempoLine(latest), loopLine(latest)].filter(Boolean).join(' · ')}
          </Txt>
          <Txt size={18} w="display" ls={0} color={C.bg} style={{ borderTopWidth: 1, borderTopColor: C.bg, paddingTop: 14 }}>
            One tap and the mic is live
          </Txt>
        </Pressable>
      ) : (
        <View style={{ backgroundColor: C.accent, borderRadius: 28, padding: 24, gap: 14 }}>
          <Txt size={12} w="semi" ls={0.1} color={C.bg}>
            START HERE
          </Txt>
          <Txt size={38} w="display" ls={-0.03} lh={1} color={C.bg}>
            Bring a beat
          </Txt>
          <Txt size={15} w="medium" lh={1.4} color={C.bg}>
            Capture one from your MPC, import a file, or pick a demo song.
          </Txt>
        </View>
      )}

      {projects.length > 0 && (
        <View>
          <View style={{ paddingBottom: 2 }}>
            <Eyebrow>Your beats</Eyebrow>
          </View>
          {projects.map((p, i) => (
            <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Open ${p.name}`} onPress={() => open(p, '/vocals')} style={[s.row, s.between, { minHeight: 56 }, i < projects.length - 1 && s.divided]}>
              <Txt size={16} w="semi" numberOfLines={1} style={{ flexShrink: 1 }}>
                {p.name}
              </Txt>
              <Txt size={13} color={C.muted}>
                {[p.beat.bpm ? `${Math.round(p.beat.bpm)} BPM` : null, p.takes.length ? plural(p.takes.length, 'take') : 'no takes yet'].filter(Boolean).join(' · ')}
              </Txt>
            </Pressable>
          ))}
        </View>
      )}

      <Foot>
        {saveError && (
          <Txt size={13} color={C.recText}>
            Changes are not being saved: {saveError}
          </Txt>
        )}
        {playable && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${playable.name} in the player`}
            onPress={() => open(playable, '/player')}
            style={[s.row, { minHeight: 60, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 14, marginBottom: 8 }]}
          >
            <CoverImage project={playable} size={40} radius={8} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt size={15} w="semi" numberOfLines={1}>
                {playable.name}
              </Txt>
              <Txt size={13} color={C.muted}>
                {playable.stats ? 'Mastered · open the player' : 'Open the player'}
              </Txt>
            </View>
            <PlayIcon size={18} />
          </Pressable>
        )}
        <Eyebrow>Add a beat</Eyebrow>
        {task.error && (
          <Txt size={13} color={C.recText}>
            {task.error}
          </Txt>
        )}
        <View style={[s.row, { gap: 10 }]}>
          <Btn kind="outline" label="Capture from MPC" to="/capture" style={{ flex: 1, minHeight: 56 }} disabled={task.busy} />
          <Btn kind="outline" label="Import a file" busy={task.busy} onPress={() => add(importBeat)} style={{ flex: 1, minHeight: 56 }} />
        </View>
        <NavLink size={14} to="/demos">
          {projects.length ? 'Add a demo song' : 'Try a demo song'}
        </NavLink>
        {projects.length === 0 && <Muted size={13}>No gear to hand? The demo songs let you try everything with just a microphone.</Muted>}
      </Foot>
    </Screen>
  );
}
