import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { tempoLine } from '@/data/labels';
import type { Project } from '@/data/model';
import { activeBeats, beatsIn } from '@/data/songs';
import { deleteProject, setCurrent, useLibrary, useSaveError } from '@/data/store';
import { loopSeconds } from '@/data/studio';
import { AddBeat } from '@/ui/AddBeat';
import { Eyebrow, Foot, MicIcon, Muted, Screen, Txt, s } from '@/ui/kit';
import { SwipeRow } from '@/ui/parts';
import { C, plural } from '@/ui/theme';
import { Columns, useWide } from '@/ui/wide';

function loopLine(p: Project) {
  const loop = loopSeconds(p.beat, p.loop);
  return loop ? `bars ${loop.startBar + 1}–${loop.startBar + loop.bars} on loop` : 'whole beat';
}

export default function Home() {
  // Finished songs live in the Vault; this is the list of beats still being worked on.
  const all = useLibrary((l) => l.projects);
  const projects = activeBeats(all);
  const done = beatsIn(all).length - projects.length;
  const saveError = useSaveError();
  const latest = projects[0];
  const wide = useWide();

  const open = (p: Project, to: '/vocals' | '/song') => {
    setCurrent(p.id);
    router.push(to);
  };

  const hero = latest ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Freestyle over ${latest.name}`} onPress={() => open(latest, '/vocals')} style={({ pressed }) => ({ backgroundColor: C.accent, borderRadius: 28, padding: wide ? 32 : 24, gap: 18, ...(wide && { flex: 1, justifyContent: 'space-between' }), opacity: pressed ? 0.9 : 1 })}>
          <View style={[s.row, s.between, { alignItems: 'flex-start' }]}>
            <View style={{ gap: 6, flex: 1 }}>
              <Txt size={12} w="semi" ls={0.1} color={C.bg}>
                FREESTYLE OVER
              </Txt>
              <Txt size={wide ? 72 : 38} w="display" ls={-0.03} lh={1} color={C.bg} numberOfLines={2}>
                {latest.name}
              </Txt>
            </View>
            <View style={{ width: wide ? 96 : 64, height: wide ? 96 : 64, borderRadius: 48, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
              <MicIcon size={wide ? 40 : 26} />
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
        <View style={{ backgroundColor: C.accent, borderRadius: 28, padding: wide ? 32 : 24, gap: 14, ...(wide && { flex: 1, justifyContent: 'center' }) }}>
          <Txt size={12} w="semi" ls={0.1} color={C.bg}>
            {done ? 'ALL CAUGHT UP' : 'START HERE'}
          </Txt>
          <Txt size={38} w="display" ls={-0.03} lh={1} color={C.bg}>
            {done ? 'Bring a new beat' : 'Bring a beat'}
          </Txt>
          <Txt size={15} w="medium" lh={1.4} color={C.bg}>
            Capture one from your gear, import a file, or pick a demo song, from the row {wide ? 'below' : 'above'}.
          </Txt>
        </View>
      );

  const beats = projects.length > 0 && (
        <View>
          <View style={{ paddingBottom: 2 }}>
            <Eyebrow>Your beats</Eyebrow>
          </View>
          {projects.map((p, i) => (
            <SwipeRow key={p.id} label={`Delete ${p.name}${p.takes.length ? ' and its takes' : ''}`} onDelete={() => void deleteProject(p.id)}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${p.name}`} onPress={() => open(p, '/song')} style={[s.row, s.between, { minHeight: 56 }, i < projects.length - 1 && s.divided]}>
              {/* A long name gives way; the tempo and take count always fit on one line. */}
              <Txt size={16} w="semi" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                {p.name}
              </Txt>
              <Txt size={13} color={C.muted} numberOfLines={1} style={{ flexShrink: 0 }}>
                {[p.beat.bpm ? `${Math.round(p.beat.bpm)} BPM` : null, p.takes.length ? plural(p.takes.length, 'take') : 'no takes yet'].filter(Boolean).join(' · ')}
              </Txt>
            </Pressable>
            </SwipeRow>
          ))}
        </View>
      );

  const finished = done > 0 && (
        <Muted size={13}>
          {done === 1 ? '1 beat has a finished song' : `${done} beats have finished songs`} in the Vault. Open a song there to record another version.
        </Muted>
      );

  const notes = (saveError || projects.length === 0) && (
        <Foot>
          {saveError && (
            <Txt size={13} color={C.recText}>
              Changes are not being saved: {saveError}
            </Txt>
          )}
          {projects.length === 0 && done === 0 && <Muted size={13}>No gear to hand? The demo songs let you try everything with just a microphone.</Muted>}
        </Foot>
      );

  // Wide: the way in on the left, the beats in progress on the right.
  if (wide)
    return (
      <Screen>
        <Columns
          inner={28}
          left={
            <>
              {hero}
              <AddBeat />
            </>
          }
          right={
            <>
              {beats}
              {finished}
              {notes}
            </>
          }
        />
      </Screen>
    );

  return (
    <Screen gap={20}>
      <AddBeat />
      {hero}
      {beats}
      {finished}
      {notes}
    </Screen>
  );
}
