import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useIsFocused } from 'expo-router';

import { useStoredImage } from '@/cover/CoverImage';
import { fileBase } from '@/data/exporting';
import { canShareFiles, saveFiles, shareFiles } from '@/data/files';
import type { SnippetChoice } from '@/data/model';
import { activeTake, patchProject, useLibrary, useProject } from '@/data/store';
import { barSeconds, useMix } from '@/data/studio';
import { strongestStretch } from '@/dsp/analysis';
import { wavePeaks } from '@/dsp/core';
import { encodeWav } from '@/dsp/wav';
import { pause, play, seek, toggle } from '@/engine/engine';
import { makeSnippetVideo, videoSupported } from '@/snippet/video';
import { Btn, Field, Foot, Muted, NavLink, Option, RoundPlay, Screen, SeekTrack, Segmented, TopBar, Txt, s } from '@/ui/kit';
import { useStopOnLeave, useTask, useTransport } from '@/ui/hooks';
import { C, clock } from '@/ui/theme';

const LENGTHS = ['15 s', '20 s', '30 s'] as const;

export default function Snippet() {
  const project = useProject();
  const profile = useLibrary((l) => l.profile);
  const take = activeTake(project);
  const { mix, busy, error } = useMix(project);
  const coverUrl = useStoredImage(project?.cover.imageKey ?? project?.cover.photoKey);
  const id = `snippet:${project?.id}`;
  const t = useTransport(id);
  const task = useTask();
  const [left, setLeft] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useStopOnLeave();

  const choice = project?.snippet;
  const length = mix ? Math.min(choice?.lengthSec ?? 20, Math.floor(mix.durationSec)) : (choice?.lengthSec ?? 20);
  const bar = barSeconds(project?.beat.bpm ?? null);

  // The loudest stretch of the chosen length, starting on a bar line when the tempo is known.
  const clip = useMemo(() => {
    if (!mix) return null;
    const start = strongestStretch(mix.channels, mix.sampleRate, length, bar ?? 0.5);
    const from = Math.round(start * mix.sampleRate);
    const to = Math.min(mix.channels[0].length, from + Math.round(length * mix.sampleRate));
    const channels = mix.channels.map((ch) => {
      const part = ch.slice(from, to);
      // Short fades so the cut does not click.
      const fade = Math.min(part.length, Math.round(mix.sampleRate * 0.03));
      for (let i = 0; i < fade; i++) {
        part[i] *= i / fade;
        part[part.length - 1 - i] *= i / fade;
      }
      return part;
    });
    return { start, channels, sampleRate: mix.sampleRate, peaks: wavePeaks(channels, 59) };
  }, [mix, length, bar]);

  const focused = useIsFocused();
  useEffect(() => {
    if (clip && focused) void play(id, { a: clip, loop: true, autoplay: false }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, focused]);

  if (!project || !choice) return <Redirect href="/" />;

  const set = (patch: Partial<SnippetChoice>) => patchProject(project.id, { snippet: { ...choice, ...patch } }, false);
  const firstLine = project.lyrics.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const caption = choice.caption.trim() || firstLine;
  const credit = profile.producer ? `Prod. ${profile.producer}` : profile.artist ? `Prod. ${profile.artist}` : null;
  const artist = profile.artist || 'You';
  const base = `${fileBase(project.name)} snippet`;

  const share = (how: 'share' | 'save') =>
    clip &&
    task.run(async () => {
      setNote(null);
      pause();
      let files;
      if (videoSupported()) {
        setLeft(Math.ceil(length));
        const video = await makeSnippetVideo(clip, { title: project.name, artist, caption: choice.captions && caption ? caption : null, credit: choice.credit ? credit : null, peaks: clip.peaks, coverUrl }, setLeft);
        files = [{ name: `${base}.${video.extension}`, data: video.blob, type: video.blob.type }];
      } else {
        files = [{ name: `${base}.wav`, data: encodeWav(clip.channels, clip.sampleRate, 16), type: 'audio/wav' }];
      }
      setLeft(null);
      const result = how === 'save' ? (await saveFiles(files), 'saved') : await shareFiles(files, project.name);
      set({ made: true });
      setNote(result === 'saved' ? `Saved ${files[0].name} to your downloads.` : result === 'shared' ? 'Shared.' : null);
    });

  const lengths = LENGTHS.filter((l) => !mix || parseInt(l, 10) <= Math.max(15, Math.floor(mix.durationSec)));

  return (
    <Screen>
      <TopBar left="Snippet" right={<NavLink to={take ? '/playback' : '/player'} back>Back</NavLink>} />

      <View style={{ height: 356, borderRadius: 24, backgroundColor: C.accent, paddingVertical: 24, paddingHorizontal: 22, justifyContent: 'space-between' }}>
        <View style={{ gap: 4 }}>
          <Txt size={project.name.length > 14 ? 36 : 48} w="display" ls={-0.03} lh={1} color={C.bg} numberOfLines={2}>
            {project.name}
          </Txt>
          <Txt size={15} w="semi" color={C.bg}>
            {artist}
          </Txt>
        </View>
        <SeekTrack peaks={clip?.peaks ?? []} height={96} progress={t.duration > 0 ? t.position / t.duration : 0} played={C.bg} rest={t.loaded && t.position > 0 ? 'rgba(18,18,18,0.35)' : C.bg} disabled={!t.loaded || t.duration <= 0} onSeek={(f) => seek(f * t.duration)} label="Position in snippet" />
        <View style={{ gap: 8, minHeight: 52, justifyContent: 'flex-end' }}>
          {choice.captions && (
            <Txt size={22} w="display" lh={1.2} ls={0} color={caption ? C.bg : 'rgba(18,18,18,0.5)'} numberOfLines={2}>
              {caption || 'Add a caption line below'}
            </Txt>
          )}
          {choice.credit && credit && (
            <Txt size={13} w="semi" ls={0.06} upper color={C.bg}>
              {credit}
            </Txt>
          )}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={[s.row, s.between]}>
          <View style={[s.row, { gap: 10 }]}>
            <RoundPlay size={36} icon={13} playing={t.playing} onPress={toggle} disabled={!clip} />
            <Txt size={15} w="semi">
              {error ? 'Could not render' : busy && !clip ? 'Finding the strongest stretch…' : 'Strongest stretch picked'}
            </Txt>
          </View>
          <Txt size={13} color={C.muted}>
            {clip ? `${clock(clip.start)} – ${clock(clip.start + length)}` : ''}
          </Txt>
        </View>
        {lengths.length > 1 && <Segmented options={lengths} value={`${choice.lengthSec} s` as (typeof LENGTHS)[number]} onChange={(v) => set({ lengthSec: parseInt(v, 10) as SnippetChoice['lengthSec'] })} variant="compact" />}
      </View>

      <View>
        <Option label="Caption on screen" checked={choice.captions} onChange={(captions) => set({ captions })} divided={!choice.captions} minHeight={46} />
        {choice.captions && (
          <View style={[s.divided, { paddingBottom: 10 }]}>
            <Field label="Caption line" value={choice.caption} onChangeText={(text) => set({ caption: text })} placeholder={firstLine || 'The line people should remember'} maxLength={80} />
          </View>
        )}
        <Option label="Producer credit on screen" checked={choice.credit} onChange={(credit2) => set({ credit: credit2 })} minHeight={46} />
      </View>

      <Foot>
        {(task.error || note || left !== null) && (
          <Txt size={13} color={task.error ? C.recText : C.muted} center>
            {task.error ?? (left !== null ? `Recording the video: ${left} s left. Keep this tab open.` : note)}
          </Txt>
        )}
        <Btn label={videoSupported() ? 'Share video' : 'Share audio'} busy={task.busy} disabled={!clip} onPress={() => share(canShareFiles() ? 'share' : 'save')} />
        {canShareFiles() && <Btn kind="outline" label={videoSupported() ? 'Save video' : 'Save audio'} size={16} disabled={task.busy || !clip} onPress={() => share('save')} style={{ flex: 0 }} />}
        <NavLink
          center
          onPress={() => {
            set({ made: true });
            router.push('/vault');
          }}
        >
          Save to the vault
        </NavLink>
        {!videoSupported() && <Muted size={12} center>This browser cannot record video, so the snippet is shared as audio.</Muted>}
      </Foot>
    </Screen>
  );
}
