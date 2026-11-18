// The artist view: the mic screen as the person at the mic needs it. They are often not the
// phone's owner, so it has their words, one record button and two ways to listen, all large
// enough to hit from a step away, and nothing that changes the song's settings.
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Btn, Chip, Eyebrow, Muted, Pulse, StopButton, Txt, s } from './kit';
import { C, clock, meterPct } from './theme';
import { useRoomy, useWide } from './wide';

export type ArtistViewProps = {
  artist: string;
  song: string;
  lyrics: string;
  /** Whether a microphone is connected, and the word on it when it is not. */
  live: boolean;
  micNote: string;
  onConnect: () => void;
  mode: 'idle' | 'listening' | 'recording';
  /** The number showing during the count-in, or 0 once the take is running. */
  count: number;
  elapsed: number;
  /** The microphone level, linear 0–1, and whether it has clipped. */
  level: number;
  clipped: boolean;
  busy: boolean;
  /** What just happened, such as a take being saved, and whether it went wrong. */
  note: string | null;
  failed: boolean;
  takes: number;
  /** Whether the last take is playing back. */
  hearing: boolean;
  onRecord: () => void;
  onBeat: () => void;
  onHear: () => void;
  onExit: () => void;
};

export function ArtistView(p: ArtistViewProps) {
  const insets = useSafeAreaInsets();
  const wide = useWide();
  const roomy = useRoomy();
  const big = wide || roomy;
  const recording = p.mode === 'recording';
  const counting = recording && p.count > 0;
  const button = big ? 176 : 148;

  const words = (
    <View style={{ flex: 1, minHeight: 120, borderRadius: 24, borderWidth: 1, borderColor: C.border, padding: big ? 28 : 18, gap: 10 }}>
      <Eyebrow>Your bars</Eyebrow>
      {p.lyrics.trim() ? (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <Txt size={big ? 34 : 26} lh={1.45}>
            {p.lyrics}
          </Txt>
        </ScrollView>
      ) : (
        <Muted size={big ? 20 : 17}>No lyrics written for this song. Freestyle it.</Muted>
      )}
    </View>
  );

  // One line that says where things stand, readable from a step back.
  const status = (
    <View accessibilityRole="alert" style={[s.row, { justifyContent: 'center', gap: 14, minHeight: big ? 96 : 72 }]}>
      {recording && <Pulse size={16} color={C.rec} on={!counting} />}
      <Txt size={counting ? (big ? 96 : 72) : recording ? (big ? 72 : 56) : big ? 28 : 22} w="display" lh={1} center color={p.failed ? C.recText : C.text} style={{ fontVariant: ['tabular-nums'], flexShrink: 1 }}>
        {counting ? p.count : recording ? clock(p.elapsed) : (p.note ?? (!p.live ? 'No microphone yet' : p.mode === 'listening' ? 'The beat is playing' : p.takes ? 'Ready for another take' : 'Ready when you are'))}
      </Txt>
    </View>
  );

  const meter = (
    <View accessible={false} style={{ height: 12, borderRadius: 6, backgroundColor: C.line, overflow: 'hidden' }}>
      <View style={{ width: `${meterPct(p.level)}%`, height: 12, backgroundColor: p.clipped && p.mode !== 'idle' ? C.rec : C.text }} />
    </View>
  );

  const controls = (
    <View style={{ gap: big ? 22 : 16, alignItems: 'center' }}>
      {p.live ? (
        // The button keeps its place when the take starts, so the tap that stops it lands where the one that started it did.
        <View style={{ height: button + 20, justifyContent: 'center' }}>
          <StopButton size={button} halo={recording} recording={recording} disabled={p.busy} label={recording ? 'Stop recording' : 'Start recording'} onPress={p.onRecord} />
        </View>
      ) : (
        <View style={{ alignSelf: 'stretch', gap: 10 }}>
          <Muted size={16} center>
            {p.micNote}
          </Muted>
          <Btn kind="light" label="Connect the microphone" onPress={p.onConnect} style={{ minHeight: 76 }} />
        </View>
      )}
      <Txt size={big ? 20 : 17} w="semi" color={C.muted} center>
        {!p.live ? '' : counting ? 'Get ready' : recording ? 'Tap to stop' : 'Tap to record'}
      </Txt>
      {/* Listening without recording: the beat by itself, and the take just made. They step aside while a take runs. */}
      {p.live && (
        <View style={[s.row, { gap: 12, alignSelf: 'stretch', minHeight: 68 }]}>
          {!recording && (
            <>
              <Btn kind="outline" size={18} label={p.mode === 'listening' ? 'Stop the beat' : 'Play the beat'} disabled={p.busy} onPress={p.onBeat} style={{ flex: 1, minHeight: 68, borderRadius: 18 }} />
              <Btn kind="outline" size={18} label={p.hearing ? 'Stop playing' : 'Hear the last take'} disabled={p.busy || p.takes === 0 || p.mode === 'listening'} onPress={p.onHear} style={{ flex: 1, minHeight: 68, borderRadius: 18 }} />
            </>
          )}
        </View>
      )}
    </View>
  );

  const top = (
    <View style={[s.row, s.between, { gap: 16, minHeight: 56 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size={big ? 40 : 28} w="display" ls={-0.02} lh={1.1} numberOfLines={1}>
          {p.artist}
        </Txt>
        <Txt size={big ? 17 : 15} color={C.muted} numberOfLines={1}>
          {p.song}
        </Txt>
      </View>
      {/* Leaving mid-take would drop the take, so the way out waits for it to end. */}
      {!recording && <Chip label="Exit artist view" onPress={p.onExit} style={{ paddingHorizontal: 16, minHeight: 48, borderRadius: 24 }} />}
    </View>
  );

  const pad = { paddingTop: Math.max(20, insets.top + 12), paddingBottom: Math.max(24, insets.bottom + 16), paddingLeft: insets.left + (big ? 40 : 20), paddingRight: insets.right + (big ? 40 : 20) };

  // On its side there is room for the words down the left and the controls beside them.
  if (wide)
    return (
      <View style={[{ flex: 1, backgroundColor: C.bg, gap: 20 }, pad]}>
        {top}
        <View style={{ flex: 1, flexDirection: 'row', gap: 40, minHeight: 0 }}>
          {words}
          <View style={{ width: 420, justifyContent: 'center', gap: 22 }}>
            {status}
            {meter}
            {controls}
          </View>
        </View>
      </View>
    );

  return (
    <View style={[{ flex: 1, backgroundColor: C.bg, gap: big ? 22 : 14 }, pad]}>
      {top}
      {words}
      {status}
      {meter}
      {controls}
    </View>
  );
}
