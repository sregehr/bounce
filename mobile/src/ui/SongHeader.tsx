import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { tempoLine } from '@/data/labels';
import type { Project } from '@/data/model';
import { patchProject } from '@/data/store';

import { Txt } from './kit';
import { C, F, clock } from './theme';
import { useWide } from './wide';

const TITLE = 24;
// The wide layout has room for a bigger name.
const TITLE_WIDE = 40;

/**
 * The top of every screen that works on one song (Song, the mic and Mix): its name, its tempo,
 * key and length, and whatever status chips the screen adds as children. The name is renamed
 * in place: tap it, type, and tap away. `locked` turns that off while a take is running.
 */
export function SongHeader({ project, locked, children }: { project: Project; locked?: boolean; children?: ReactNode }) {
  const [naming, setNaming] = useState(false);
  const size = useWide() ? TITLE_WIDE : TITLE;
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
            style={{ fontFamily: F.display, fontSize: size, letterSpacing: size * -0.02, lineHeight: Math.round(size * 1.15), color: C.text, borderBottomWidth: 1, borderBottomColor: C.accent, paddingBottom: 3 }}
          />
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${project.name}`} disabled={locked} onPress={() => setNaming(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt size={size} w="display" ls={-0.02} lh={1.15} numberOfLines={2} style={{ flexShrink: 1 }}>
              {project.name}
            </Txt>
            {/* A pencil says the name can be changed; it goes while a take is running, when it cannot. */}
            {!locked && (
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" stroke={C.muted} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            )}
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
