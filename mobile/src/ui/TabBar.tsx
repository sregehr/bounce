import type { ReactNode } from 'react';
import { Animated, Platform, Pressable, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { micLead, mixLead, songLead, type Lead } from '@/data/songs';
import { setCurrent, useLibrary } from '@/data/store';
import { openInput, useEngine } from '@/engine/engine';

import { Btn, MicIcon, Muted, Txt } from './kit';
import { Logo } from './Logo';
import { Halo, Pop, useGlide } from './motion';
import { PersonalMenu } from './PersonalMenu';
import { SongSwitcher } from './SongSwitcher';
import { useArtistViewOpen } from './artistViewOpen';
import { useRecordControl } from './recordControl';
import { TOP_NAV_HEIGHT, hidesTabBar, tabFor, type Tab } from './tabs';
import { useBar, useGutter, useWide } from './wide';
import { C } from './theme';

type IconProps = { on: boolean; color: string; size: number };

const stroke = { strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Glyph({ size, children }: { size: number; children: ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {children}
    </Svg>
  );
}

/** Each glyph is an outline at rest and solid when its tab is selected, as iOS tab bars do. */
function HomeGlyph({ on, color, size }: IconProps) {
  return (
    <Glyph size={size}>
      <Path d="M4 10.6 12 4l8 6.6V18.5A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5z" stroke={color} fill={on ? color : 'none'} {...stroke} />
      <Path d="M10 20v-5h4v5" stroke={on ? C.bg : color} {...stroke} />
    </Glyph>
  );
}

function VaultGlyph({ on, color, size }: IconProps) {
  return (
    <Glyph size={size}>
      <Rect x={3} y={4.5} width={18} height={4.5} rx={1.5} stroke={color} fill={on ? color : 'none'} {...stroke} />
      <Path d="M5 9v9a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9z" stroke={color} fill={on ? color : 'none'} {...stroke} />
      <Path d="M10 13.2h4" stroke={on ? C.bg : color} {...stroke} />
    </Glyph>
  );
}

function SongGlyph({ on, color, size }: IconProps) {
  return (
    <Glyph size={size}>
      <Path d="M9.5 17.5V6.2l9-2v11.3" stroke={color} {...stroke} />
      <Circle cx={7} cy={17.5} r={2.5} stroke={color} fill={on ? color : 'none'} {...stroke} />
      <Circle cx={16} cy={15.5} r={2.5} stroke={color} fill={on ? color : 'none'} {...stroke} />
    </Glyph>
  );
}

function MixGlyph({ on, color, size }: IconProps) {
  const knob = { r: 2.2, stroke: color, fill: on ? color : C.bg, strokeWidth: 1.8 };
  return (
    <Glyph size={size}>
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

function Item({ label, on, onPress, Icon }: { label: string; on: boolean; onPress: () => void; Icon: (p: IconProps) => ReactNode }) {
  const color = on ? C.text : 'rgba(255,255,255,0.74)';
  const bar = useBar();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      // The tab in view sits in a darker well inside the capsule.
      style={({ pressed }) => ({ flex: 1, height: bar.height - 12, borderRadius: (bar.height - 12) / 2, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: on ? 'rgba(0,0,0,0.42)' : 'transparent', opacity: pressed ? 0.55 : 1 })}
    >
      <Icon on={on} color={color} size={bar.glyph} />
      <Txt size={bar.label} w={on ? 'semi' : 'medium'} ls={0.01} color={color}>
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
  // The artist view has the mic screen to itself.
  const booth = useArtistViewOpen() && path === '/vocals';
  const tab = tabFor(path, !!library.projects.find((p) => p.id === library.currentId)?.saved);
  return { path, library, tab: recording || holding || booth ? null : tab, booth };
}

/**
 * The top bar, above every screen after the welcome: the logo and the personal menu. On Song, the
 * mic and Mix, which all work on one song, the logo gives way to that song's name, as the way to switch.
 */
export function TopNav() {
  const { path, tab, library } = useNav();
  const insets = useSafeAreaInsets();
  // The logo and the menu line up with the content below them: its column, or the margins of the two panes.
  const column = useGutter();
  const wide = useWide();
  const gutter = wide ? 40 : column;
  const edge = wide ? { left: insets.left, right: insets.right } : { left: 0, right: 0 };
  if (!tab) return null;
  // The song those three screens are showing. With no beat yet they have nothing to name, and the logo stays.
  const current = tab === 'song' || tab === 'mic' || tab === 'mix' ? library.projects.find((p) => p.id === library.currentId && !p.saved) : undefined;
  return (
    <View style={[{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.14)' }, glass]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, height: TOP_NAV_HEIGHT, paddingLeft: gutter + edge.left, paddingRight: gutter - 12 + edge.right }}>
        {current ? (
          <SongSwitcher library={library} beat={current} left={gutter + edge.left} onPick={setCurrent} onHome={() => follow({ to: '/', id: null }, path)} />
        ) : (
          <Pressable accessibilityRole="link" accessibilityLabel="Bounce: home" onPress={() => follow({ to: '/', id: null }, path)} hitSlop={8}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Logo size={20} />
              <Txt size={20} w="display" ls={-0.02}>
                Bounce
              </Txt>
            </View>
          </Pressable>
        )}
        <PersonalMenu onNavigate={(to) => follow({ to }, path)} />
      </View>
    </View>
  );
}

/** The mic in the navigation: the way to the mic screen, where recording starts and stops. */
function useMic() {
  const { path, library, tab, booth } = useNav();
  const mic = micLead(library);
  const beat = mic.id ? library.projects.find((p) => p.id === mic.id) : null;
  const is = (t: Tab) => tab === t;
  // Like the tabs beside it, it is lit while its screen is the one in view, and a tap there changes nothing.
  const lit = is('mic');
  return { path, library, tab, mic, beat, is, lit, booth };
}

// The mic at rest: a dark disc, so the yellow is kept for when it is selected.
const REST = 'rgb(30,30,32)';

function MicButton({ nav, style }: { nav: ReturnType<typeof useMic>; style?: ViewStyle }) {
  const { path, mic, beat, is, lit } = nav;
  const { mic: MIC } = useBar();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={beat ? `Freestyle over ${beat.name}` : 'Add a beat to freestyle'}
      accessibilityState={{ selected: is('mic') }}
      hitSlop={6}
      onPress={() => follow(mic, path)}
      style={({ pressed }) => ({
        width: MIC,
        height: MIC,
        borderRadius: MIC / 2,
        // Like the glyphs beside it, the mic is an outline at rest and solid once it is the tab in view.
        backgroundColor: lit ? C.accent : REST,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: lit ? 0.5 : 2,
        borderColor: lit ? 'rgba(255,255,255,0.4)' : C.accent,
        boxShadow: lit ? '0 10px 28px rgba(0,0,0,0.5), 0 6px 22px rgba(255,176,32,0.4), inset 0 1px 0 rgba(255,255,255,0.35)' : '0 10px 28px rgba(0,0,0,0.5)',
        transform: [{ scale: pressed ? 0.93 : 1 }],
        ...style,
      })}
    >
      <MicIcon size={Math.round(MIC * 0.44)} color={lit ? C.bg : C.accent} />
    </Pressable>
  );
}

/**
 * Bottom navigation, floating over the page: a glass capsule with Home, Song, Mix and Vault, and
 * the mic raised in the middle of it, which leads to the mic screen. Every tab always works; one with nothing to show yet leads
 * to the step that gets there.
 */
export function TabBar() {
  const nav = useMic();
  const { path, library, tab, is } = nav;
  const insets = useSafeAreaInsets();
  const bar = useBar();
  const bottom = Math.max(bar.lift, insets.bottom);
  // While a take runs, or waits to be saved, or the phone is handed over in the artist view, the bar steps aside: a stray tap cannot end a take.
  if (!tab || hidesTabBar(path) || nav.booth) return null;

  const button = (
    <View style={{ width: bar.mic + 12, height: bar.height, alignItems: 'center' }}>
      <MicButton nav={nav} style={{ position: 'absolute', top: -14 }} />
    </View>
  );

  // On a wider screen the capsule stays a comfortable size in the middle instead of stretching edge to edge.
  // It is centred by the layout itself, not worked out from the window's width, which a scaled or split view can report wrongly.
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 14, right: 14, bottom, alignItems: 'center' }}>
    <View accessibilityRole="tablist" style={[{ width: '100%', maxWidth: bar.max, height: bar.height, borderRadius: bar.height / 2, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }, floating]}>
      <Item label="Home" on={is('home')} onPress={() => follow({ to: '/', id: null }, path)} Icon={HomeGlyph} />
      <Item label="Song" on={is('song')} onPress={() => follow(songLead(library), path)} Icon={SongGlyph} />
      {/* The mic sits in the middle, raised out of the capsule. */}
      {button}
      <Item label="Mix" on={is('mix')} onPress={() => follow(mixLead(library), path)} Icon={MixGlyph} />
      <Item label="Vault" on={is('vault')} onPress={() => follow({ to: '/vault' }, path)} Icon={VaultGlyph} />
    </View>
    </View>
  );
}
