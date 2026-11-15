import type { ReactNode } from 'react';
import { Platform, Pressable, View, type ViewStyle } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { micLead, mixLead, playerLead, type Lead } from '@/data/songs';
import { openSong, setCurrent, useLibrary } from '@/data/store';
import { useEngine } from '@/engine/engine';

import { MicIcon, Txt } from './kit';
import { TAB_BAR_HEIGHT, TOP_NAV_HEIGHT, tabFor, type Tab } from './tabs';
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

function PlayerGlyph({ on, color }: IconProps) {
  return (
    <Glyph>
      <Circle cx={12} cy={12} r={8.6} stroke={color} fill={on ? color : 'none'} {...stroke} />
      <Path d="M10.3 8.6v6.8l5.4-3.4z" stroke={on ? C.bg : color} fill={on ? C.bg : color} strokeWidth={1.2} strokeLinejoin="round" />
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

function GearGlyph({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10.3 3.6h3.4l.5 2.3 1.6.9 2.2-.8 1.7 3-1.7 1.6v1.8l1.7 1.6-1.7 3-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-3 1.7-1.6v-1.8L4.3 9l1.7-3 2.2.8 1.6-.9z"
        stroke={color}
        {...stroke}
      />
      <Circle cx={12} cy={12} r={2.8} stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

/**
 * Opens where a tab leads. Tabs sit one level above the home screen, so the stack never grows
 * as you move between them. A lead may carry a hint for the screen to show.
 */
function follow(lead: Lead | { to: '/vault' | '/settings'; id?: null; hint?: undefined }, from: string) {
  if (lead.id) (lead.to === '/player' ? openSong : setCurrent)(lead.id);
  if (lead.to === from) return router.setParams({ hint: lead.hint });
  const href = { pathname: lead.to, params: lead.hint ? { hint: lead.hint } : {} } as const;
  if (router.canDismiss()) router.dismissAll();
  if (lead.to === '/') router.replace(href);
  else router.push(href);
}

function Item({ label, on, onPress, Icon }: { label: string; on: boolean; onPress: () => void; Icon: (p: IconProps) => ReactNode }) {
  const color = on ? C.accent : C.muted;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, height: TAB_BAR_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 3, opacity: pressed ? 0.55 : 1 })}
    >
      <Icon on={on} color={color} />
      <Txt size={10} w={on ? 'semi' : 'medium'} ls={0.01} color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}

// Content scrolls beneath the bar; the web build blurs it as iOS does, native falls back to a near-solid fill.
const glass = (Platform.OS === 'web'
  ? { backgroundColor: 'rgba(18,18,18,0.72)', backdropFilter: 'saturate(180%) blur(24px)', WebkitBackdropFilter: 'saturate(180%) blur(24px)' }
  : { backgroundColor: 'rgba(18,18,18,0.96)' }) as ViewStyle;

/** Where the navigation is, and what is lit. It steps aside while a recording is running, so a stray tap cannot end a take. */
function useNav() {
  const path = usePathname();
  const library = useLibrary((l) => l);
  const recording = useEngine((e) => e.take.mode !== 'idle' || e.capture.status !== 'idle');
  const tab = tabFor(path, !!library.projects.find((p) => p.id === library.currentId)?.saved);
  return { path, library, tab: recording ? null : tab };
}

/** The logo and Settings, above every screen after the welcome. */
export function TopNav() {
  const { path, tab } = useNav();
  const insets = useSafeAreaInsets();
  if (!tab) return null;
  const on = tab === 'settings';
  return (
    <View style={[{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.14)' }, glass]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: TOP_NAV_HEIGHT, paddingLeft: 24, paddingRight: 12 }}>
        <Pressable accessibilityRole="link" accessibilityLabel="Bounce: home" onPress={() => follow({ to: '/', id: null }, path)} hitSlop={8}>
          <Txt size={20} w="display" ls={-0.02}>
            Bounce
          </Txt>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Settings"
          accessibilityState={{ selected: on }}
          onPress={() => follow({ to: '/settings' }, path)}
          style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}
        >
          <GearGlyph color={on ? C.accent : C.muted} />
        </Pressable>
      </View>
    </View>
  );
}

/** Bottom navigation: Home, Player, the mic, Mix, Vault. Every tab always works; one with nothing to show yet leads to the step that gets there. */
export function TabBar() {
  const { path, library, tab } = useNav();
  const insets = useSafeAreaInsets();
  if (!tab) return null;
  const is = (t: Tab) => tab === t;
  const mic = micLead(library);
  const beat = mic.id ? library.projects.find((p) => p.id === mic.id) : null;

  return (
    <View accessibilityRole="tablist" style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.14)' }, glass]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: TAB_BAR_HEIGHT, paddingHorizontal: 4 }}>
        <Item label="Home" on={is('home')} onPress={() => follow({ to: '/', id: null }, path)} Icon={HomeGlyph} />
        <Item label="Player" on={is('player')} onPress={() => follow(playerLead(library), path)} Icon={PlayerGlyph} />
        <View style={{ width: 76, height: TAB_BAR_HEIGHT, alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={beat ? `Freestyle over ${beat.name}` : 'Add a beat to freestyle'}
            accessibilityState={{ selected: is('mic') }}
            hitSlop={6}
            onPress={() => follow(mic, path)}
            style={({ pressed }) => ({
              position: 'absolute',
              top: -18,
              width: 62,
              height: 62,
              borderRadius: 31,
              backgroundColor: C.accent,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: is('mic') ? 2 : 0.5,
              borderColor: is('mic') ? C.text : 'rgba(255,255,255,0.28)',
              boxShadow: '0 8px 22px rgba(255,176,32,0.28), 0 2px 6px rgba(0,0,0,0.5)',
              transform: [{ scale: pressed ? 0.93 : 1 }],
            })}
          >
            <MicIcon size={28} color={C.bg} />
          </Pressable>
        </View>
        <Item label="Mix" on={is('mix')} onPress={() => follow(mixLead(library), path)} Icon={MixGlyph} />
        <Item label="Vault" on={is('vault')} onPress={() => follow({ to: '/vault' }, path)} Icon={VaultGlyph} />
      </View>
    </View>
  );
}
