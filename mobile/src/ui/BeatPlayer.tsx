import { useEffect } from 'react';
import { View } from 'react-native';

import type { Project } from '@/data/model';
import { loadPcm } from '@/data/studio';
import { play, seek, toggle } from '@/engine/engine';

import { useTask, useTransport } from './hooks';
import { Card, RoundPlay, SeekTrack, Txt, s } from './kit';
import { C, clock } from './theme';

/** Plays a beat by itself, with its waveform to seek on. For a song that has no take to play yet. */
export function BeatPlayer({ project, note }: { project: Project; note?: string }) {
  const beat = project.beat;
  const id = `beat:${project.id}`;
  const t = useTransport(id);
  const task = useTask();

  // Start decoding straight away so the play button answers at once.
  useEffect(() => {
    void loadPcm(beat.key).catch(() => {});
  }, [beat.key]);

  const onPlay = () => {
    if (t.loaded) return toggle();
    void task.run(async () => play(id, { a: await loadPcm(beat.key) }));
  };
  const progress = t.duration > 0 ? t.position / t.duration : 0;

  return (
    <Card style={{ paddingVertical: 18, paddingHorizontal: 16 }}>
      <SeekTrack peaks={beat.wave} height={64} progress={t.loaded ? progress : 0} rest={C.text} disabled={!t.loaded || t.duration <= 0} onSeek={(f) => seek(f * t.duration)} label="Position in beat" />
      <View style={[s.row, { gap: 14 }]}>
        <RoundPlay size={48} icon={18} playing={t.playing} onPress={onPlay} disabled={task.busy} label={t.playing ? 'Pause the beat' : 'Play the beat'} />
        <View style={{ gap: 2, flex: 1 }}>
          <Txt size={15} w="medium">
            {t.loaded && t.position > 0 ? `${clock(t.position)} of ${clock(beat.durationSec)}` : clock(beat.durationSec)}
          </Txt>
          <Txt size={13} color={task.error ? C.recText : C.muted}>
            {task.error ?? note ?? 'The beat by itself'}
          </Txt>
        </View>
      </View>
    </Card>
  );
}
