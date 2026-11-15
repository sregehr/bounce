import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoverImage } from '@/cover/CoverImage';
import { exportFiles } from '@/data/exporting';
import { shareFiles } from '@/data/files';
import { songsIn } from '@/data/songs';
import { activeTake, openSong, patchProject, useLibrary, useProject } from '@/data/store';
import { useSong } from '@/data/song';
import { spectrum } from '@/engine/engine';
import { Btn, PauseIcon, PlayIcon, SkipIcon, Slider, Txt, s } from '@/ui/kit';
import { useStopOnLeave, useTask } from '@/ui/hooks';
import { TAB_BAR_HEIGHT, TOP_NAV_HEIGHT } from '@/ui/tabs';
import { C, F, clock, lufs } from '@/ui/theme';

const BARS = 34;

/** Bars that follow the sound of whatever is playing. */
function Visualiser({ playing }: { playing: boolean }) {
  const [levels, setLevels] = useState<number[]>(() => new Array(BARS).fill(0.08));
  useEffect(() => {
    if (!playing) return;
    let frame = 0, last = 0;
    const step = (now: number) => {
      if (now - last > 45) {
        last = now;
        setLevels(spectrum(BARS));
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  return (
    <View accessible={false} style={{ height: 88, flexDirection: 'row', alignItems: 'flex-end', gap: 4, paddingHorizontal: 24, paddingTop: 16, overflow: 'hidden' }}>
      {levels.map((v, i) => (
        <View key={i} style={{ flex: 1, maxWidth: 6, height: Math.max(4, Math.round(72 * Math.min(1, v * 1.15))), borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: i % 5 === 0 ? C.text : C.accent }} />
      ))}
    </View>
  );
}

export default function Player() {
  const project = useProject();
  const projects = useLibrary((l) => l.projects);
  const profile = useLibrary((l) => l.profile);
  const song = useSong(project);
  const share = useTask();
  const [drag, setDrag] = useState<number | null>(null);
  const [lyrics, setLyrics] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  useStopOnLeave();

  if (!project) return <Redirect href="/" />;

  const { t, mix } = song;
  const take = activeTake(project);
  // Skipping moves through the finished songs in the Vault.
  const songs = songsIn(projects);
  const at = songs.findIndex((p) => p.id === project.id);
  const jump = (step: number) => {
    const next = songs[(at + step + songs.length) % songs.length];
    if (next && next.id !== project.id) openSong(next.id);
    else song.seek(0);
  };
  const pill = { backgroundColor: C.bg } as const;
  const credit = [profile.artist || 'You', profile.producer ? `Prod. ${profile.producer}` : null].filter(Boolean).join(' · ');
  const onShare = () =>
    share.run(async () => {
      setNote(null);
      const files = await exportFiles({ ...project, exporting: { ...project.exporting, instrumental: false, vocals: false } });
      const result = await shareFiles(files, `${project.name}${profile.artist ? ` by ${profile.artist}` : ''}`);
      setNote(result === 'saved' ? `Saved ${files[0].name} to your downloads.` : result === 'shared' ? 'Shared.' : null);
    });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 600 }}>
        <CoverImage project={project} fill />
      </View>

      <View style={[s.topbar, { paddingHorizontal: 16, paddingTop: insets.top + TOP_NAV_HEIGHT + 12 }]}>
        <Pressable accessibilityRole="link" accessibilityLabel="Mastering settings" onPress={() => router.push('/master')} style={[pill, { borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12 }]}>
          <Txt size={12} w="semi" ls={0.08} upper color={song.error ? C.recText : C.muted}>
            {song.error ? 'Could not render' : !mix ? song.stage || 'Mastering' : [take ? 'Mastered' : 'Beat', project.overrides.master ? 'by hand' : project.master.style, lufs(mix.lufs, 0)].join(' · ')}
          </Txt>
        </Pressable>
      </View>

      <View style={{ flexGrow: 1 }} />
      <Visualiser playing={t.playing} />

      <View style={{ backgroundColor: C.bg, paddingTop: 20, paddingHorizontal: 24, paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 28, gap: 14 }}>
        <View style={[s.row, { gap: 14 }]}>
          <Pressable accessibilityRole="link" accessibilityLabel="Change cover art" onPress={() => router.push('/cover')}>
            <CoverImage project={project} size={60} radius={12} />
          </Pressable>
          <View style={{ gap: 3, flex: 1 }}>
            <Txt size={30} w="display" ls={-0.03} lh={1.05} numberOfLines={1}>
              {project.name}
            </Txt>
            <Txt size={14} color={C.muted} numberOfLines={1}>
              {song.error ?? credit}
            </Txt>
          </View>
        </View>

        {lyrics ? (
          <View style={{ gap: 6 }}>
            <TextInput
              accessibilityLabel="Lyrics"
              multiline
              value={project.lyrics}
              onChangeText={(text) => patchProject(project.id, { lyrics: text })}
              placeholder="Write the bars here. They show up in vault search, and the first line can caption a snippet."
              placeholderTextColor={C.muted}
              selectionColor={C.accent}
              style={{ minHeight: 132, maxHeight: 132, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, color: C.text, fontFamily: F.regular, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' }}
            />
          </View>
        ) : (
          <>
            <View style={{ gap: 2 }}>
              <Slider
                label="Position in track"
                value={Math.min(drag ?? t.position, t.duration)}
                min={0}
                max={Math.max(1, t.duration)}
                step={0.1}
                height={28}
                disabled={!t.loaded}
                onChange={setDrag}
                onCommit={(v) => {
                  setDrag(null);
                  song.seek(v);
                }}
              />
              <View style={[s.row, s.between]}>
                <Txt size={13} color={C.muted} style={{ fontVariant: ['tabular-nums'] }}>
                  {clock(drag ?? t.position)}
                </Txt>
                <Txt size={13} color={C.muted} style={{ fontVariant: ['tabular-nums'] }}>
                  {clock(t.duration || project.stats?.durationSec || 0)}
                </Txt>
              </View>
            </View>

            <View style={[s.row, { justifyContent: 'center', gap: 28 }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous track" onPress={() => (t.position > 3 ? song.seek(0) : jump(-1))} style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
                <SkipIcon back />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.playing ? 'Pause' : 'Play'}
                disabled={!t.loaded}
                onPress={song.toggle}
                style={({ pressed }) => ({ width: 72, height: 72, borderRadius: 36, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', opacity: !t.loaded ? 0.4 : pressed ? 0.85 : 1 })}
              >
                {t.playing ? <PauseIcon color={C.bg} /> : <PlayIcon size={26} color={C.bg} />}
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Next track" onPress={() => jump(1)} style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
                <SkipIcon />
              </Pressable>
            </View>
          </>
        )}

        {(share.error || note) && (
          <Txt size={13} color={share.error ? C.recText : C.muted} center>
            {share.error ?? note}
          </Txt>
        )}
        <View style={[s.row, { gap: 10 }]}>
          <Btn kind="outline" label="Snippet" to="/snippet" style={{ flex: 1, borderRadius: 14, minHeight: 48 }} />
          <Btn kind="outline" label={lyrics ? 'Done' : 'Lyrics'} onPress={() => setLyrics(!lyrics)} style={{ flex: 1, borderRadius: 14, minHeight: 48 }} />
          <Btn kind="outline" label="Share" busy={share.busy} onPress={onShare} style={{ flex: 1, borderRadius: 14, minHeight: 48 }} />
        </View>
      </View>
    </View>
  );
}
