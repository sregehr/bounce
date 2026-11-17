import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, TextInput, View, type ViewStyle } from 'react-native';
import { Redirect, router, useIsFocused } from 'expo-router';

import { useStoredImage } from '@/cover/CoverImage';
import { fileBase } from '@/data/exporting';
import { canShareFiles, saveFiles, shareFiles, type OutFile } from '@/data/files';
import type { SnippetChoice } from '@/data/model';
import { activeTake, patchProject, useLibrary, useProject } from '@/data/store';
import { artistOf } from '@/data/songs';
import { barSeconds, useMix } from '@/data/studio';
import { strongestStretch } from '@/dsp/analysis';
import { wavePeaks } from '@/dsp/core';
import { encodeWav } from '@/dsp/wav';
import { pause, play, seek, toggle } from '@/engine/engine';
import { SCRIM, makeSnippetVideo, videoSupported } from '@/snippet/video';
import { Btn, Foot, Muted, NavLink, Option, RoundPlay, Screen, SeekTrack, Segmented, TopBar, Txt, s } from '@/ui/kit';
import { useStopOnLeave, useTask, useTransport } from '@/ui/hooks';
import { asSheet } from '@/ui/nav';
import { WindowTrack } from '@/ui/WindowTrack';
import { C, F, clock } from '@/ui/theme';
import { useWide } from '@/ui/wide';

const LENGTHS = ['15 s', '20 s', '30 s'] as const;
/** How long a snippet takes to fade out at its end. */
const FADE_OUT_SEC = 3;

const SHAPES = ['Tall 9:16', 'Square 1:1', 'Wide 16:9'] as const;
const SHAPE_OF = { 'Tall 9:16': 'tall', 'Square 1:1': 'square', 'Wide 16:9': 'wide' } as const;
const SHAPE_LABEL = { tall: 'Tall 9:16', square: 'Square 1:1', wide: 'Wide 16:9' } as const;

function Snippet() {
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
  // What is being typed into the caption, once it has been touched.
  const [draft, setDraft] = useState<string | null>(null);
  // The snippet once it has been made, and what it was made from, so a change makes it again.
  const [ready, setReady] = useState<{ recipe: string; files: OutFile[] } | null>(null);
  const wide = useWide();
  useStopOnLeave();

  const choice = project?.snippet;
  const shape = choice?.shape ?? 'tall';
  const length = mix ? Math.min(choice?.lengthSec ?? 20, Math.floor(mix.durationSec)) : (choice?.lengthSec ?? 20);
  const bar = barSeconds(project?.beat.bpm ?? null);

  // The loudest stretch of the chosen length, starting on a bar line when the tempo is known.
  const strongest = useMemo(() => (mix ? strongestStretch(mix.channels, mix.sampleRate, length, bar ?? 0.5) : 0), [mix, length, bar]);
  // Where the snippet starts: there, unless it has been moved along the song.
  const room = mix ? Math.max(0, mix.durationSec - length) : 0;
  const moved = choice?.startSec ?? null;
  const start = Math.max(0, Math.min(room, moved ?? strongest));
  const whole = useMemo(() => (mix ? wavePeaks(mix.channels, 160) : []), [mix]);
  // A stretch that was just picked plays straight away; the first one waits for the play button.
  const playNext = useRef(false);

  const clip = useMemo(() => {
    if (!mix) return null;
    const from = Math.round(start * mix.sampleRate);
    const to = Math.min(mix.channels[0].length, from + Math.round(length * mix.sampleRate));
    const channels = mix.channels.map((ch) => {
      const part = ch.slice(from, to);
      // A quick fade in so the cut does not click, and a 3 second fade out so it ends like a song and not a cut.
      const fadeIn = Math.min(part.length, Math.round(mix.sampleRate * 0.03));
      for (let i = 0; i < fadeIn; i++) part[i] *= i / fadeIn;
      const fadeOut = Math.min(Math.floor(part.length * 0.4), Math.round(mix.sampleRate * FADE_OUT_SEC));
      for (let i = 0; i < fadeOut; i++) part[part.length - 1 - i] *= i / fadeOut;
      return part;
    });
    return { start, channels, sampleRate: mix.sampleRate, peaks: wavePeaks(channels, 59) };
  }, [mix, length, start]);

  const focused = useIsFocused();
  useEffect(() => {
    if (clip && focused) void play(id, { a: clip, loop: true, autoplay: playNext.current }).catch(() => {});
    playNext.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, focused]);

  if (!project || !choice) return <Redirect href="/" />;

  const set = (patch: Partial<SnippetChoice>) => patchProject(project.id, { snippet: { ...choice, ...patch } }, false);
  const firstLine = project.lyrics.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  // The caption is written on the card itself. Until it is touched it starts as the first lyric line.
  const shown = draft ?? (choice.caption || firstLine);
  const caption = shown.trim();
  const credit = profile.producer ? `Prod. ${profile.producer}` : profile.artist ? `Prod. ${profile.artist}` : null;
  const artist = artistOf(project, profile);
  const base = `${fileBase(project.name)} snippet`;

  // Making the snippet takes as long as the snippet is, and a phone only opens its share sheet
  // straight after a tap. So it is made first, and sharing or saving it is a second tap.
  const recipe = clip ? JSON.stringify([project.id, clip.start, length, choice.captions && caption, choice.credit && credit, coverUrl, shape]) : '';
  const fresh = ready && ready.recipe === recipe ? ready.files : null;

  const make = () =>
    clip &&
    task.run(async () => {
      setNote(null);
      pause();
      let files: OutFile[];
      if (videoSupported()) {
        setLeft(Math.ceil(length));
        const video = await makeSnippetVideo(clip, { title: project.name, artist, caption: choice.captions && caption ? caption : null, credit: choice.credit ? credit : null, peaks: clip.peaks, coverUrl }, setLeft, shape);
        files = [{ name: `${base}${shape === 'tall' ? '' : ` (${shape})`}.${video.extension}`, data: video.blob, type: video.blob.type }];
      } else {
        files = [{ name: `${base}.wav`, data: encodeWav(clip.channels, clip.sampleRate, 16), type: 'audio/wav' }];
      }
      setLeft(null);
      setReady({ recipe, files });
      set({ made: true });
      setNote(canShareFiles() ? 'Snippet ready. Share it, or save it to this device.' : 'Snippet ready to save.');
    });

  const send = (how: 'share' | 'save') =>
    fresh &&
    task.run(async () => {
      const result = how === 'save' ? (await saveFiles(fresh), 'saved') : await shareFiles(fresh, project.name);
      setNote(result === 'saved' ? `Saved ${fresh[0].name} to your downloads.` : result === 'shared' ? 'Shared.' : null);
    });

  // Dark ink on the plain amber card; light ink over a photo, which is shaded the same way the video shades it.
  const ink = coverUrl ? C.text : C.bg;
  const faint = coverUrl ? 'rgba(242,240,234,0.4)' : 'rgba(18,18,18,0.35)';
  const shade = (Platform.OS === 'web'
    ? { backgroundImage: `linear-gradient(to bottom, ${SCRIM.map(([at, dark]) => `rgba(18,18,18,${dark}) ${at * 100}%`).join(', ')})` }
    : { backgroundColor: 'rgba(18,18,18,0.68)' }) as ViewStyle;

  const lengths = LENGTHS.filter((l) => !mix || parseInt(l, 10) <= Math.max(15, Math.floor(mix.durationSec)));

  // What the video shows. With a cover photo it is the backdrop, darkened so the light words and bars read on any picture.
  const card = (
      <View style={[{ height: 356, borderRadius: 24, overflow: 'hidden', backgroundColor: coverUrl ? C.bg : C.accent, paddingVertical: 24, paddingHorizontal: 22, justifyContent: 'space-between' }, wide && { flex: 1, height: undefined, minHeight: 520, borderRadius: 28, paddingVertical: 32, paddingHorizontal: 28 }]}>
        {coverUrl && (
          <>
            <Image source={{ uri: coverUrl }} accessibilityIgnoresInvertColors resizeMode="cover" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
            <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, shade]} />
          </>
        )}
        <View style={{ gap: wide ? 6 : 4 }}>
          <Txt size={wide ? (project.name.length > 14 ? 48 : 64) : project.name.length > 14 ? 36 : 48} w="display" ls={-0.03} lh={1} color={ink} numberOfLines={wide ? 3 : 2}>
            {project.name}
          </Txt>
          <Txt size={wide ? 17 : 15} w="semi" color={ink}>
            {artist}
          </Txt>
        </View>
        <SeekTrack peaks={clip?.peaks ?? []} height={wide ? 140 : 96} progress={t.duration > 0 ? t.position / t.duration : 0} played={ink} rest={t.loaded && t.position > 0 ? faint : ink} disabled={!t.loaded || t.duration <= 0} onSeek={(f) => seek(f * t.duration)} label="Position in snippet" />
        <View style={{ gap: wide ? 10 : 8, minHeight: 52, justifyContent: 'flex-end' }}>
          {choice.captions && (
            <TextInput
              accessibilityLabel="Caption line"
              multiline
              numberOfLines={2}
              submitBehavior="blurAndSubmit"
              value={shown}
              onChangeText={(text) => {
                const line = text.replace(/\n/g, ' ');
                setDraft(line);
                set({ caption: line });
              }}
              placeholder="Tap to add a caption line"
              placeholderTextColor={coverUrl ? 'rgba(242,240,234,0.6)' : 'rgba(18,18,18,0.5)'}
              selectionColor={ink}
              maxLength={80}
              style={[{ fontFamily: F.display, fontSize: 22, lineHeight: 26, height: 54, color: ink, padding: 0 }, wide && { fontSize: 28, lineHeight: 34, height: 70 }]}
            />
          )}
          {choice.credit && credit && (
            <Txt size={13} w="semi" ls={0.06} upper color={ink}>
              {credit}
            </Txt>
          )}
        </View>
      </View>
  );

  const pick = (
      <View style={{ gap: 8 }}>
        <View style={[s.row, s.between]}>
          <View style={[s.row, { gap: 10 }]}>
            <RoundPlay size={wide ? 48 : 36} icon={13} playing={t.playing} onPress={toggle} disabled={!clip} />
            <Txt size={15} w="semi">
              {error ? 'Could not render' : busy && !clip ? 'Finding the strongest stretch…' : moved === null ? 'Strongest stretch picked' : 'Your pick'}
            </Txt>
          </View>
          <Txt size={13} color={C.muted}>
            {clip ? `${clock(clip.start)} – ${clock(clip.start + length)}` : ''}
          </Txt>
        </View>
        {/* The whole song, with the snippet lit: drag it to another part and it plays from there. */}
        {/* Only when there is somewhere to move it to: a song barely longer than the snippet has no other stretch. */}
        {mix && room >= 2 && (
          <View style={{ gap: 4 }}>
            <WindowTrack
              label="Snippet position"
              peaks={whole}
              height={wide ? 84 : 56}
              from={start / mix.durationSec}
              span={length / mix.durationSec}
              snap={(f) => (bar ? (Math.round((f * mix.durationSec) / bar) * bar) / mix.durationSec : f)}
              disabled={task.busy}
              onMove={(f) => {
                playNext.current = true;
                set({ startSec: Math.round(f * mix.durationSec * 1000) / 1000 });
              }}
            />
            <View style={[s.row, s.between]}>
              <Muted size={13}>Drag the lit part to choose another stretch.</Muted>
              {moved !== null && (
                <NavLink size={13} style={{ minHeight: wide ? 44 : 24 }} onPress={() => ((playNext.current = true), set({ startSec: null }))}>
                  Strongest stretch
                </NavLink>
              )}
            </View>
          </View>
        )}
        {lengths.length > 1 && <Segmented options={lengths} value={`${choice.lengthSec} s` as (typeof LENGTHS)[number]} onChange={(v) => set({ lengthSec: parseInt(v, 10) as SnippetChoice['lengthSec'] })} variant="compact" />}
      </View>
  );

  const options = (
      <View>
        {videoSupported() && (
          <View style={{ gap: 6, paddingBottom: 10 }}>
            <Segmented options={SHAPES} value={SHAPE_LABEL[shape]} onChange={(v) => set({ shape: SHAPE_OF[v] })} variant="compact" />
            <Muted size={12}>{shape === 'tall' ? 'For Reels, TikTok, Shorts and Stories. The words stay clear of their buttons.' : shape === 'square' ? 'For feeds and messages.' : 'For YouTube and X.'}</Muted>
          </View>
        )}
        <Option label="Caption on screen" sub={choice.captions ? 'Tap the line on the card to change it.' : undefined} checked={choice.captions} onChange={(captions) => set({ captions })} divided minHeight={46} />
        <Option label="Producer credit on screen" checked={choice.credit} onChange={(credit2) => set({ credit: credit2 })} minHeight={46} />
      </View>
  );

  const status = (task.error || note || left !== null) && (
          <Txt size={13} color={task.error ? C.recText : C.muted} center>
            {task.error ?? (left !== null ? `Recording the video: ${left} s left. Keep this tab open.` : note)}
          </Txt>
        );
  // Once made: with a share sheet, sharing leads and saving is the second button. Without one, it can only be saved.
  // Until it has been made (or after a change), the one button makes it.
  const lead = !fresh ? (
    <Btn label="Make snippet" busy={task.busy} disabled={!clip} onPress={make} style={wide && { flex: 1 }} />
  ) : (
    <Btn label={canShareFiles() ? 'Share snippet' : 'Save snippet'} busy={task.busy} onPress={() => send(canShareFiles() ? 'share' : 'save')} style={wide && { flex: 1 }} />
  );
  const second = !!fresh && canShareFiles() && <Btn kind="outline" label="Save snippet" size={16} disabled={task.busy} onPress={() => send('save')} style={wide ? { flex: 1, minHeight: 56 } : { flex: 0 }} />;
  const finish = (
        <NavLink
          center
          onPress={() => {
            set({ made: true });
            // The sheet, and the player under it, are closed first: the Vault is not pushed on top of them.
            if (router.canDismiss()) router.dismissAll();
            router.push('/vault');
          }}
        >
          Done, back to the Vault
        </NavLink>
  );
  const audioOnly = !videoSupported() && <Muted size={12} center>This browser cannot record video, so the snippet is audio only.</Muted>;

  // Wide: the card stands tall on the left, as the video is; choosing the stretch and sending it are on the right.
  if (wide)
    return (
      <Screen>
        <View style={{ flex: 1, flexDirection: 'row', gap: 48, minHeight: 0 }}>
          <View style={{ width: 430 }}>{card}</View>
          <View style={{ flex: 1, minWidth: 0, gap: 16 }}>
            <TopBar left="Snippet" right={<NavLink to={project.saved ? '/player' : '/playback'} back>Back</NavLink>} />
            {pick}
            {options}
            <Foot>
              {status}
              <View style={[s.row, { gap: 12 }]}>
                {second}
                {lead}
              </View>
              {finish}
              {audioOnly}
            </Foot>
          </View>
        </View>
      </Screen>
    );

  return (
    <Screen>
      <TopBar left="Snippet" right={<NavLink to={project.saved ? '/player' : '/playback'} back>Back</NavLink>} />

      {card}

      {pick}

      {options}

      <Foot>
        {status}
        {lead}
        {second}
        {finish}
        {audioOnly}
      </Foot>
    </Screen>
  );
}

// A sheet over the player or the mix.
export default asSheet(Snippet, { fallback: '/vault' });
