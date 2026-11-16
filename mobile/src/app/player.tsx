import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoverImage } from '@/cover/CoverImage';
import { useProject } from '@/data/store';
import { spectrum } from '@/engine/engine';
import { Btn, Eyebrow, NavLink, Txt, s } from '@/ui/kit';
import { useStopOnLeave } from '@/ui/hooks';
import { Scrubber, SkipPlay, useNowPlaying } from '@/ui/NowPlaying';
import { C } from '@/ui/theme';
import { useWide } from '@/ui/wide';

const BARS = 34;

/** Bars that follow the sound of whatever is playing. `tall` is the wide layout's, spread along the bottom of the cover. */
function Visualiser({ playing, tall }: { playing: boolean; tall?: boolean }) {
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
    <View accessible={false} style={[{ height: 88, flexDirection: 'row', alignItems: 'flex-end', gap: 4, paddingHorizontal: 24, paddingTop: 16, overflow: 'hidden' }, tall && { height: 112, gap: 6, paddingHorizontal: 28, pointerEvents: 'none' }]}>
      {levels.map((v, i) => (
        <View key={i} style={{ flex: 1, maxWidth: tall ? undefined : 6, height: Math.max(4, Math.round((tall ? 96 : 72) * Math.min(1, v * 1.15))), borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: i % 5 === 0 ? C.text : C.accent }} />
      ))}
    </View>
  );
}

export default function Player() {
  const project = useProject();
  const now = useNowPlaying(project);
  const [lyrics, setLyrics] = useState(false);
  const insets = useSafeAreaInsets();
  const wide = useWide();
  useStopOnLeave();

  if (!project) return <Redirect href="/vault" />;

  const { song, credit, hasLyrics, beat } = now;
  const t = song.t;
  const pill = { backgroundColor: C.bg } as const;
  /** The player is full screen, opened from the Vault; closing it returns there. */
  const close = () => {
    if (router.canDismiss()) router.dismissAll();
    router.push('/vault');
  };

  const mastering = (
        <Pressable accessibilityRole="link" accessibilityLabel="Mastering settings" onPress={() => router.push('/master')} style={[pill, { borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12 }, wide && { minHeight: 44, borderRadius: 22, paddingHorizontal: 14, justifyContent: 'center' }]}>
          <Txt size={12} w="semi" ls={0.08} upper color={song.error ? C.recText : C.muted}>
            {now.mastering}
          </Txt>
        </Pressable>
  );

  const shut = (
        <Pressable accessibilityRole="button" accessibilityLabel="Close the player" onPress={close} hitSlop={8} style={[pill, { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, wide && { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.borderStrong }]}>
          <Txt size={18} w="semi" color={C.text}>
            ✕
          </Txt>
        </Pressable>
  );

  const again = beat && (
          <NavLink center size={14} onPress={now.again}>
            {now.againLabel}
          </NavLink>
  );

  // Wide: the cover fills the left half; the song, its controls and its lyrics sit on the right, with nothing to toggle.
  if (wide)
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
        <View style={{ width: '52%', overflow: 'hidden', justifyContent: 'space-between' }}>
          <Pressable accessibilityRole="link" accessibilityLabel="Change cover art" onPress={() => router.push('/cover')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            <CoverImage project={project} fill />
          </Pressable>
          <View style={{ alignItems: 'flex-start', paddingTop: Math.max(28, insets.top + 12), paddingLeft: Math.max(28, insets.left + 12), pointerEvents: 'box-none' }}>{mastering}</View>
          <Visualiser playing={t.playing} tall />
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: 18, paddingTop: Math.max(28, insets.top + 12), paddingLeft: 40, paddingRight: Math.max(40, insets.right + 16), paddingBottom: Math.max(32, insets.bottom + 12) }}>
          <View style={[s.row, s.between, { alignItems: 'flex-start', gap: 16 }]}>
            <View style={{ gap: 4, flex: 1, minWidth: 0 }}>
              <Txt size={44} w="display" ls={-0.03} lh={1.05} numberOfLines={2}>
                {project.name}
              </Txt>
              <Txt size={15} color={C.muted} numberOfLines={1}>
                {song.error ?? credit}
              </Txt>
            </View>
            {shut}
          </View>

          <Scrubber now={now} height={32} />
          <SkipPlay now={now} size={80} skip={56} gap={36} />

          {hasLyrics ? (
            <View style={{ flex: 1, minHeight: 0, gap: 8 }}>
              <Eyebrow>Lyrics</Eyebrow>
              {/* Lyrics are written on the Song tab; a finished song shows the ones it was saved with. */}
              <ScrollView accessibilityLabel="Lyrics" style={{ flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16 }} contentContainerStyle={{ padding: 16 }}>
                <Txt size={17} lh={1.6}>
                  {project.lyrics.trim()}
                </Txt>
              </ScrollView>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          <View style={[s.row, { gap: 10 }]}>
            <Btn kind="outline" label="Snippet" to="/snippet" style={{ flex: 1, borderRadius: 14 }} />
            <Btn kind="outline" label="Share" to="/export" style={{ flex: 1, borderRadius: 14 }} />
          </View>
          {again}
        </View>
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 600 }}>
        <CoverImage project={project} fill />
      </View>

      <View style={[s.topbar, { paddingHorizontal: 16, paddingTop: Math.max(20, insets.top + 8) }]}>
        {mastering}
        {shut}
      </View>

      <View style={{ flexGrow: 1 }} />
      <Visualiser playing={t.playing} />

      <View style={{ backgroundColor: C.bg, paddingTop: 20, paddingHorizontal: 24, paddingBottom: Math.max(28, insets.bottom + 12), gap: 14 }}>
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

        {lyrics && hasLyrics ? (
          // Lyrics are written on the Song tab; a finished song shows the ones it was saved with.
          <ScrollView accessibilityLabel="Lyrics" style={{ minHeight: 132, maxHeight: 132, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14 }} contentContainerStyle={{ padding: 14 }}>
            <Txt size={15} lh={1.4}>
              {project.lyrics.trim()}
            </Txt>
          </ScrollView>
        ) : (
          <>
            <Scrubber now={now} />
            <SkipPlay now={now} />
          </>
        )}

        <View style={[s.row, { gap: 10 }]}>
          <Btn kind="outline" label="Snippet" to="/snippet" style={{ flex: 1, borderRadius: 14, minHeight: 48 }} />
          {hasLyrics && <Btn kind="outline" label={lyrics ? 'Done' : 'Lyrics'} onPress={() => setLyrics(!lyrics)} style={{ flex: 1, borderRadius: 14, minHeight: 48 }} />}
          {/* Sharing opens the choices first (loudness, format, stems), then the share sheet or a saved file. */}
          <Btn kind="outline" label="Share" to="/export" style={{ flex: 1, borderRadius: 14, minHeight: 48 }} />
        </View>
        {again}
      </View>
    </View>
  );
}
