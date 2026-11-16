import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { tempoLine } from '@/data/labels';
import type { Project } from '@/data/model';
import { patchProject } from '@/data/store';

import { Txt } from './kit';
import { C, F, clock } from './theme';

const TITLE = 24;

/**
 * The top of every screen that works on one song (Song, the mic and Mix): its name, its tempo,
 * key and length, and whatever status chips the screen adds as children. The name is renamed
 * in place: tap it, type, and tap away. `locked` turns that off while a take is running.
 */
export function SongHeader({ project, locked, children }: { project: Project; locked?: boolean; children?: ReactNode }) {
  const [naming, setNaming] = useState(false);
  const done = () => {
    if (!project.name.trim()) patchProject(project.id, { name: 'Untitled beat' });
    setNaming(false);
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        {naming && !locked ? (
          <TextInput
            accessibilityLabel="Name"
            autoFocus
            selectTextOnFocus
            value={project.name}
            onChangeText={(name) => patchProject(project.id, { name })}
            onBlur={done}
            onSubmitEditing={done}
            selectionColor={C.accent}
            maxLength={60}
            style={{ fontFamily: F.display, fontSize: TITLE, letterSpacing: -0.5, lineHeight: 28, color: C.text, borderBottomWidth: 1, borderBottomColor: C.accent, paddingBottom: 3 }}
          />
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${project.name}`} disabled={locked} onPress={() => setNaming(true)}>
            <Txt size={TITLE} w="display" ls={-0.02} lh={1.15} numberOfLines={2}>
              {project.name}
            </Txt>
          </Pressable>
        )}
        <Txt size={13} color={C.muted}>
          {[tempoLine(project) || 'Tempo not set', clock(project.beat.durationSec)].join(' · ')}
        </Txt>
      </View>
      {children ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View> : null}
    </View>
  );
}
