import type { ReactNode } from 'react';
import { Platform, Pressable, View, type ViewStyle } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { micLead, mixLead, songLead, type Lead } from '@/data/songs';
import { setCurrent, useLibrary } from '@/data/store';
import { openInput, useEngine } from '@/engine/engine';

import { Btn, MicIcon, Muted, Txt } from './kit';
import { Logo } from './Logo';
import { PersonalMenu } from './PersonalMenu';
import { askForMic, useAskingForMic, useRecordControl } from './recordControl';
import { TOP_NAV_HEIGHT, hidesTabBar, tabFor, type Tab } from './tabs';
import { RAIL_WIDTH } from './wide';
import { C } from './theme';

type IconProps = { on: boolean; color: string };

const stroke = { strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Glyph({ children }: { children: ReactNode }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      {children}
    </Svg>
  );
}

/** Each glyph is an outline at rest and solid when its tab is selected, as iOS tab bars do. */
function HomeGlyph({ on, color }: IconProps) {
  return (
    <Glyph>
      <Path d="M4 10.6 12 4l8 6.6V18.5A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5z" stroke={color} fill={on ? color : 'none'} {...stroke} />
      <Path d="M10 20v-5h4v5" stroke={on ? C.bg : color} {...stroke} />
    </Glyph>
  );
}

function VaultGlyph({ on, color }: IconProps) {
  return (
    <Glyph>
      <Rect x={3} y={4.5} width={18} height={4.5} rx={1.5} stroke={color} fill={on ? color : 'none'} {...stroke} />
      <Path d="M5 9v9a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9z" stroke={color} fill={on ? color : 'none'} {...stroke} />
      <Path d="M10 13.2h4" stroke={on ? C.bg : color} {...stroke} />
    </Glyph>
  );
}

function SongGlyph({ on, color }: IconProps) {
  return (
    <Glyph>
      <Path d="M9.5 17.5V6.2l9-2v11.3" stroke={color} {...stroke} />
      <Circle cx={7} cy={17.5} r={2.5} stroke={color} fill={on ? color : 'none'} {...stroke} />
      <Circle cx={16} cy={15.5} r={2.5} stroke={color} fill={on ? color : 'none'} {...stroke} />
    </Glyph>
  );
}

function MixGlyph({ on, color }: IconProps) {
  const knob = { r: 2.2, stroke: color, fill: on ? color : C.bg, strokeWidth: 1.8 };
  return (
    <Glyph>
      <Path d="M4 7h16M4 12h16M4 17h16" stroke={color} {...stroke} />
      <Circle cx={15.5} cy={7} {...knob} />
      <Circle cx={8.5} cy={12} {...knob} />
      <Circle cx={14} cy={17} {...knob} />
    </Glyph>
  );
}

/**
 * Opens where a tab leads. Tabs sit one level above the home screen, so the stack never grows
 * as you move between them.
 */
function follow(lead: Lead | { to: '/' | '/vault' | '/settings' | '/profile'; id?: null }, from: string) {
  if (lead.id) setCurrent(lead.id);
  if (lead.to === from) return;
  const href = lead.to;
  if (router.canDismiss()) router.dismissAll();
  if (lead.to === '/') router.replace(href);
  else router.push(href);
}

function Item({ label, on, onPress, Icon, rail }: { label: string; on: boolean; onPress: () => void; Icon: (p: IconProps) => ReactNode; rail?: boolean }) {
  const color = on ? C.text : 'rgba(255,255,255,0.74)';
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      // The tab in view sits in a darker well inside the capsule.
      style={({ pressed }) => ({ ...(rail ? { width: 60, height: 58 } : { flex: 1, height: BAR_HEIGHT - 12 }), borderRadius: (BAR_HEIGHT - 12) / 2, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: on ? 'rgba(0,0,0,0.42)' : 'transparent', opacity: pressed ? 0.55 : 1 })}
    >
      <Icon on={on} color={color} />
      <Txt size={10.5} w={on ? 'semi' : 'medium'} ls={0.01} color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}

// Content scrolls beneath the navigation; the web build blurs it as iOS does, native falls back to a near-solid fill.
const glass = (Platform.OS === 'web'
  ? { backgroundColor: 'rgba(18,18,18,0.72)', backdropFilter: 'saturate(180%) blur(24px)', WebkitBackdropFilter: 'saturate(180%) blur(24px)' }
  : { backgroundColor: 'rgba(18,18,18,0.96)' }) as ViewStyle;

// The floating bar: a lighter, more translucent glass with a bright rim, lifted off the page by a shadow.
const BAR_HEIGHT = 64;
const MIC = 64;
const floating = {
  ...(Platform.OS === 'web'
    ? { backgroundColor: 'rgba(58,58,62,0.62)', backdropFilter: 'saturate(180%) blur(28px)', WebkitBackdropFilter: 'saturate(180%) blur(28px)' }
    : { backgroundColor: 'rgba(52,52,56,0.96)' }),
  borderWidth: 0.5,
  borderColor: 'rgba(255,255,255,0.22)',
  boxShadow: '0 10px 28px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.14)',
} as ViewStyle;

/** Where the navigation is, and what is lit. It steps aside while a recording is running, so a stray tap cannot end a take. */
function useNav() {
  const path = usePathname();
  const library = useLibrary((l) => l);
  const recording = useEngine((e) => e.take.mode !== 'idle' || e.capture.status !== 'idle');
  // Leaving the mic screen would drop a take that has not been saved yet, so the tabs wait for that too.
  const holding = !!useRecordControl()?.holding;
  const tab = tabFor(path, !!library.projects.find((p) => p.id === library.currentId)?.saved);
  return { path, library, tab: recording || holding ? null : tab };
}

/** The logo and the personal menu, above every screen after the welcome. */
export function TopNav() {
  const { path, tab } = useNav();
  const insets = useSafeAreaInsets();
  if (!tab) return null;
  return (
    <View style={[{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.14)' }, glass]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: TOP_NAV_HEIGHT, paddingLeft: 24, paddingRight: 12 }}>
        <Pressable accessibilityRole="link" accessibilityLabel="Bounce: home" onPress={() => follow({ to: '/', id: null }, path)} hitSlop={8}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Logo size={20} />
            <Txt size={20} w="display" ls={-0.02}>
              Bounce
            </Txt>
          </View>
        </Pressable>
        <PersonalMenu onNavigate={(to) => follow({ to }, path)} />
      </View>
    </View>
  );
}

/** What the mic in the navigation is right now: a way to the mic screen, or that screen's record button. */
function useMic() {
  const { path, library, tab } = useNav();
  const control = useRecordControl();
  // On the mic screen the mic is the record button, and it stays up alone while a take runs.
  const record = path === '/vocals' ? control : null;
  const input = useEngine((e) => e.input);
  const asking = useAskingForMic() && record?.state === 'off';
  const mic = micLead(library);
  const beat = mic.id ? library.projects.find((p) => p.id === mic.id) : null;
  const recording = record?.state === 'recording';
  const is = (t: Tab) => tab === t;
  const lit = is('mic') || !!record;
  return { path, library, tab, record, input, asking, mic, beat, recording, is, lit };
}

function MicButton({ nav, style }: { nav: ReturnType<typeof useMic>; style?: ViewStyle }) {
  const { path, record, mic, beat, recording, is, lit } = nav;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={record ? (recording ? 'Stop recording' : 'Start recording') : beat ? `Freestyle over ${beat.name}` : 'Add a beat to freestyle'}
      accessibilityState={{ selected: is('mic'), busy: !!record?.busy }}
      hitSlop={6}
      onPress={() => (record ? record.press() : follow(mic, path))}
      style={({ pressed }) => ({
        width: MIC,
        height: MIC,
        borderRadius: MIC / 2,
        backgroundColor: recording ? C.rec : C.accent,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: lit ? 2 : 0.5,
        borderColor: lit ? C.text : 'rgba(255,255,255,0.4)',
        boxShadow: `0 10px 28px rgba(0,0,0,0.5), 0 6px 18px ${recording ? 'rgba(255,75,62,0.35)' : 'rgba(255,176,32,0.25)'}, inset 0 1px 0 rgba(255,255,255,0.35)`,
        opacity: record?.busy ? 0.6 : 1,
        transform: [{ scale: pressed ? 0.93 : 1 }],
        ...style,
      })}
    >
      {recording ? <View style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: C.text }} /> : <MicIcon size={28} color={C.bg} />}
    </Pressable>
  );
}

/** With no microphone connected, the record button opens this beside itself rather than recording. */
function MicPrompt({ nav, style, cover }: { nav: ReturnType<typeof useMic>; style: ViewStyle; cover: ViewStyle }) {
  const { input, library } = nav;
  return (
    <>
      <Pressable accessibilityLabel="Close" onPress={() => askForMic(false)} style={[{ position: 'absolute' }, cover]} />
      <View accessibilityRole="alert" style={[{ position: 'absolute', borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, padding: 18, gap: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.55)' }, style]}>
        <Txt size={17} w="display" ls={0}>
          No microphone yet
        </Txt>
        <Muted size={14}>{input.error ?? 'Bounce needs a microphone to record your take. It only listens while this screen is open.'}</Muted>
        <Btn label="Connect a microphone" busy={input.status === 'opening'} onPress={() => void openInput(library.settings.inputId, 'mic')} />
      </View>
    </>
  );
}

/**
 * Bottom navigation, floating over the page: a glass capsule with Home, Song, Mix and Vault, and
 * the mic raised in the middle of it. Every tab always works; one with nothing to show yet leads
 * to the step that gets there.
 */
export function TabBar() {
  const nav = useMic();
  const { path, library, tab, record, asking, is } = nav;
  const insets = useSafeAreaInsets();
  if ((!tab && !record) || hidesTabBar(path)) return null;

  const button = (
    <View style={{ width: MIC + 12, height: BAR_HEIGHT, alignItems: 'center' }}>
      <MicButton nav={nav} style={{ position: 'absolute', top: -14 }} />
    </View>
  );

  // While a take runs the tabs step aside, so a stray tap cannot end it; only the button stays.
  if (!tab) return <View style={{ position: 'absolute', left: 14, right: 14, bottom: Math.max(12, insets.bottom), height: BAR_HEIGHT, alignItems: 'center' }}>{button}</View>;

  return (
    <View accessibilityRole="tablist" style={[{ position: 'absolute', left: 14, right: 14, bottom: Math.max(12, insets.bottom), height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }, floating]}>
      {asking && <MicPrompt nav={nav} cover={{ left: -14, right: -14, bottom: -40, height: 2000 }} style={{ left: 0, right: 0, bottom: BAR_HEIGHT + 24 }} />}
      <Item label="Home" on={is('home')} onPress={() => follow({ to: '/', id: null }, path)} Icon={HomeGlyph} />
      <Item label="Song" on={is('song')} onPress={() => follow(songLead(library), path)} Icon={SongGlyph} />
      {/* The mic sits in the middle, raised out of the capsule. */}
      {button}
      <Item label="Mix" on={is('mix')} onPress={() => follow(mixLead(library), path)} Icon={MixGlyph} />
      <Item label="Vault" on={is('vault')} onPress={() => follow({ to: '/vault' }, path)} Icon={VaultGlyph} />
    </View>
  );
}

/**
 * The same navigation for the wide layout: a rail down the left edge, with the logo above the
 * capsule and the personal menu below it. It stands in for both the top bar and the bottom bar.
 */
export function Rail() {
  const nav = useMic();
  const { path, library, tab, record, asking, is } = nav;
  const insets = useSafeAreaInsets();
  if (!tab && !record) return null;
  const edge = { position: 'absolute', left: insets.left, top: 0, bottom: 0, width: RAIL_WIDTH, paddingTop: Math.max(28, insets.top + 12), paddingBottom: Math.max(24, insets.bottom + 12), alignItems: 'center', justifyContent: 'space-between' } as const;

  // While a take runs only the button stays, where it was.
  if (!tab)
    return (
      <View style={[edge, { justifyContent: 'center' }]}>
        <MicButton nav={nav} />
      </View>
    );

  return (
    <View style={edge}>
      <Pressable accessibilityRole="link" accessibilityLabel="Bounce: home" onPress={() => follow({ to: '/', id: null }, path)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Logo size={28} />
      </Pressable>
      <View accessibilityRole="tablist" style={[{ width: 72, borderRadius: 36, padding: 6, gap: 4, alignItems: 'center' }, floating]}>
        <Item rail label="Home" on={is('home')} onPress={() => follow({ to: '/', id: null }, path)} Icon={HomeGlyph} />
        <Item rail label="Song" on={is('song')} onPress={() => follow(songLead(library), path)} Icon={SongGlyph} />
        <MicButton nav={nav} style={{ marginVertical: 6 }} />
        <Item rail label="Mix" on={is('mix')} onPress={() => follow(mixLead(library), path)} Icon={MixGlyph} />
        <Item rail label="Vault" on={is('vault')} onPress={() => follow({ to: '/vault' }, path)} Icon={VaultGlyph} />
        {asking && <MicPrompt nav={nav} cover={{ left: -40, top: -1000, width: 4000, height: 3000 }} style={{ left: 84, top: 96, width: 320 }} />}
      </View>
      <PersonalMenu rail onNavigate={(to) => follow({ to }, path)} />
    </View>
  );
}
