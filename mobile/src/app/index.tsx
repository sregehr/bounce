import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { tempoLine } from '@/data/labels';
import type { Project } from '@/data/model';
import { activeBeats, beatsIn, stageOf } from '@/data/songs';
import { removeProject, setCurrent, useLibrary, useSaveError } from '@/data/store';
import { AddBeat } from '@/ui/AddBeat';
import { EmptyBeats } from '@/ui/EmptyBeats';
import { Eyebrow, Foot, MicIcon, Muted, Screen, Txt, s } from '@/ui/kit';
import { DotMenu } from '@/ui/DotMenu';
import { DeletedToast, SwipeRow } from '@/ui/parts';
import { useLargeText, useRowLines } from '@/ui/type';
import { C } from '@/ui/theme';
import { Columns, useWide } from '@/ui/wide';

export default function Home() {
  // Finished songs live in the Vault; this is the list of beats still being worked on.
  const all = useLibrary((l) => l.projects);
  const projects = activeBeats(all);
  const done = beatsIn(all).length - projects.length;
  const saveError = useSaveError();
  const latest = projects[0];
  const wide = useWide();
  const large = useLargeText();
  const lines = useRowLines();

  const open = (p: Project, to: '/vocals' | '/song') => {
    setCurrent(p.id);
    router.push(to);
  };

  // The two ways into the beat worked on last, each named for where it leads.
  const way = (label: string, name: string, to: '/vocals' | '/song', solid: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={() => open(latest, to)}
      style={({ pressed }) => ({ flex: 1, minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: solid ? C.bg : 'transparent', borderWidth: 1.5, borderColor: C.bg, opacity: pressed ? 0.8 : 1 })}
    >
      {solid && <MicIcon size={18} />}
      <Txt size={16} w="display" color={solid ? C.accent : C.bg}>
        {label}
      </Txt>
    </Pressable>
  );

  const hero = latest ? (
        <View style={{ backgroundColor: C.accent, borderRadius: 28, padding: wide ? 32 : 22, gap: 18, ...(wide && { flex: 1, justifyContent: 'space-between' }) }}>
          <View style={{ gap: 6 }}>
            <Txt size={12} w="semi" ls={0.1} color={C.bg}>
              PICK UP WHERE YOU LEFT OFF
            </Txt>
            <Txt size={wide ? 72 : 38} w="display" ls={-0.03} lh={1} color={C.bg} numberOfLines={2}>
              {latest.name}
            </Txt>
          </View>
          {/* Where the beat stands and the two buttons stay together at the foot of the card when it is tall. */}
          <View style={{ gap: 16 }}>
            <Txt size={15} w="medium" lh={1.4} color={C.bg}>
              {[tempoLine(latest), stageOf(latest, all)].filter(Boolean).join(' · ')}
            </Txt>
            <View style={[s.row, { gap: 10 }]}>
              {way('Record', `Record over ${latest.name}`, '/vocals', true)}
              {way('Open song', `Open song ${latest.name}`, '/song', false)}
            </View>
          </View>
        </View>
      ) : (
        <View style={{ backgroundColor: C.accent, borderRadius: 28, padding: wide ? 32 : 24, gap: 14, ...(wide && { flex: 1, justifyContent: 'center' }) }}>
          <Txt size={12} w="semi" ls={0.1} color={C.bg}>
            {done ? 'ALL CAUGHT UP' : 'START HERE'}
          </Txt>
          <Txt size={38} w="display" ls={-0.03} lh={1} color={C.bg}>
            {done ? 'Bring a new beat' : 'Bring a beat'}
          </Txt>
          <Txt size={15} w="medium" lh={1.4} color={C.bg}>
            Capture one from your gear, import a file, or pick a demo song, from the row below.
          </Txt>
        </View>
      );

  const beats = projects.length > 0 && (
        <View>
          <View style={{ paddingBottom: 2 }}>
            <Eyebrow>Your beats</Eyebrow>
          </View>
          {projects.map((p, i) => (
            // Deleting is one tap, from the menu or a swipe, and can be taken back for a few seconds.
            <SwipeRow key={p.id} once label={`Delete ${p.name}${p.takes.length ? ' and its takes' : ''}`} onDelete={() => removeProject(p.id)}>
            <View style={[s.row, { gap: 4 }, i < projects.length - 1 && s.divided]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${p.name}`} onPress={() => open(p, '/song')} style={[s.row, s.between, { flex: 1, minHeight: 60, gap: 12, paddingVertical: 9 }]}>
              {/* The name, and under it where the beat stands: what is left to do, not only a count. */}
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Txt size={16} w="semi" numberOfLines={lines}>
                  {p.name}
                </Txt>
                <Txt size={13} color={C.muted} numberOfLines={large ? 2 : 1}>
                  {stageOf(p, all)}
                </Txt>
              </View>
            </Pressable>
            <DotMenu
              label={`More for ${p.name}`}
              items={[
                { label: 'Record', onPress: () => open(p, '/vocals') },
                { label: 'Open song', onPress: () => open(p, '/song') },
                { label: 'Delete', danger: true, onPress: () => removeProject(p.id) },
              ]}
            />
            </View>
            </SwipeRow>
          ))}
        </View>
      );

  const finished = done > 0 && (
        <Muted size={13}>
          {done === 1 ? '1 beat has a finished song' : `${done} beats have finished songs`} in the Vault. Open a song there to record another version.
        </Muted>
      );

  const none = projects.length === 0;
  const notes = (saveError || none) && (
        // Beside the picture on a wide screen the notes sit under it, instead of taking half the column.
        <Foot style={wide && none && { flexGrow: 0 }}>
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
      <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen>
        <Columns
          inner={28}
          left={
            <>
              {hero}
              <AddBeat fold={!none} />
            </>
          }
          right={
            <>
              {beats}
              {none && (
                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <EmptyBeats caption />
                </View>
              )}
              {finished}
              {notes}
            </>
          }
        />
      </Screen>
      <DeletedToast />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <Screen gap={20}>
      {/* Continuing leads. With no beat yet, the card says where to start and the ways to add one follow it; once there are beats, adding is one button under them. */}
      {hero}
      {none && <AddBeat />}
      {beats}
      {!none && <AddBeat fold />}
      {none && <EmptyBeats width={240} />}
      {finished}
      {notes}
    </Screen>
    <DeletedToast />
    </View>
  );
}
