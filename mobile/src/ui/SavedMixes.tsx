import { useState } from 'react';
import { View } from 'react-native';

import type { MixSettings, MixSnapshot, Project } from '@/data/model';
import { SNAPSHOT_LIMIT, compareSnapshot, deleteSnapshot, renameSnapshot, restoreSnapshot, saveSnapshot } from '@/data/store';

import { useArmed } from './hooks';
import { Chip, Eyebrow, Field, Muted, NavLink, Txt, s } from './kit';
import { C, dayLabel, lufs } from './theme';

const same = (a: MixSettings | undefined, b: MixSettings) => !!a && JSON.stringify([a.polish, a.master, a.overrides, a.space ?? null]) === JSON.stringify([b.polish, b.master, b.overrides, b.space ?? null]);

function Row({ project, mix, last }: { project: Project; mix: MixSnapshot; last: boolean }) {
  const [armed, arm] = useArmed();
  const [name, setName] = useState<string | null>(null);
  const side = project.mixSide ?? 'A';
  const other = side === 'A' ? 'B' : 'A';
  const inUse = same(project, mix.mix);
  const compared = same(project.mixAlt, mix.mix);
  const done = () => {
    if (name !== null) renameSnapshot(project.id, mix.id, name);
    setName(null);
  };
  return (
    <View style={[{ paddingVertical: 10, gap: 2 }, !last && s.divided]}>
      {name !== null ? (
        <Field label={`Name for ${mix.name}`} value={name} onChangeText={setName} onBlur={done} onSubmitEditing={done} autoFocus maxLength={40} returnKeyType="done" />
      ) : (
        <View style={[s.row, s.between, { gap: 12 }]}>
          <Txt size={16} w="semi" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {mix.name}
          </Txt>
          <Txt size={13} color={inUse ? C.accent : C.muted} numberOfLines={1} style={{ flexShrink: 0 }}>
            {inUse ? `In use on Mix ${side}` : compared ? `On Mix ${other}` : [dayLabel(mix.at), mix.loud ? lufs(mix.loud.lufs) : null].filter(Boolean).join(' · ')}
          </Txt>
        </View>
      )}
      <View style={[s.row, { gap: 18, flexWrap: 'wrap' }]}>
        {!inUse && (
          <NavLink size={14} onPress={() => restoreSnapshot(project.id, mix.id)}>
            {`Use ${mix.name}`}
          </NavLink>
        )}
        {!inUse && !compared && (
          <NavLink size={14} onPress={() => compareSnapshot(project.id, mix.id)}>
            {`Compare as Mix ${other}`}
          </NavLink>
        )}
        {name === null && (
          <NavLink size={14} onPress={() => setName(mix.name)}>
            Rename
          </NavLink>
        )}
        <NavLink tone="danger" size={14} onPress={() => (armed ? deleteSnapshot(project.id, mix.id) : arm())}>
          {armed ? `Tap again to delete ${mix.name}` : 'Delete'}
        </NavLink>
      </View>
    </View>
  );
}

/**
 * Mixes kept by name on a song: save the one in use, go back to one, or put one on the other
 * side of Mix A and Mix B to compare. Saving costs nothing; the audio is rendered again when a
 * saved mix is used.
 */
export function SavedMixes({ project }: { project: Project }) {
  const saved = project.snapshots ?? [];
  const full = saved.length >= SNAPSHOT_LIMIT;
  return (
    <View style={{ paddingTop: 6 }}>
      <View style={[s.row, s.between, { gap: 12, minHeight: 44 }]}>
        <Eyebrow>Saved mixes</Eyebrow>
        <Chip label="Save this mix" onPress={() => !full && saveSnapshot(project.id)} style={{ paddingHorizontal: 14, opacity: full ? 0.35 : 1 }} />
      </View>
      {saved.length === 0 ? (
        <Muted size={13}>Keep a mix you like before changing it, then come back to it or compare the two.</Muted>
      ) : (
        saved.map((mix, i) => <Row key={mix.id} project={project} mix={mix} last={i === saved.length - 1} />)
      )}
      {full && <Muted size={13}>{`A song keeps up to ${SNAPSHOT_LIMIT} saved mixes. Delete one to save another.`}</Muted>}
    </View>
  );
}
