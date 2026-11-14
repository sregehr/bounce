import type { ReactNode } from 'react';
import { Platform, Pressable, View, type ViewStyle } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { setCurrent, useLibrary, useProject } from '@/data/store';

import { MicIcon, Txt } from './kit';
import { TAB_BAR_HEIGHT, tabFor, type Tab } from './tabs';
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

function SettingsGlyph({ on, color }: IconProps) {
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

/** Tabs sit one level above the home screen, so the stack never grows as you move between them. */
function open(to: '/' | '/vault' | '/player' | '/settings' | '/vocals', from: string) {
  if (to === from) return;
  if (router.canDismiss()) router.dismissAll();
  if (to === '/') router.replace('/');
  else router.push(to);
}

function Item({ label, on, disabled, onPress, Icon }: { label: string; on: boolean; disabled?: boolean; onPress: () => void; Icon: (p: IconProps) => ReactNode }) {
  const color = on ? C.accent : C.muted;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, height: TAB_BAR_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 3, opacity: disabled ? 0.32 : pressed ? 0.55 : 1 })}
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

/** Bottom navigation for the app's main areas. Hidden on the focused screens (recording, polishing, exporting). */
export function TabBar() {
  const path = usePathname();
  const tab = tabFor(path);
  const insets = useSafeAreaInsets();
  const projects = useLibrary((l) => l.projects);
  const current = useProject();
  if (!tab) return null;

  const beat = current ?? projects[0];
  const ready = (p: (typeof projects)[number]) => p.takes.length > 0 || !!p.stats;
  // The player plays a bare beat too, so any project will do; one with something recorded or mastered is preferred.
  const playable = current ?? projects.find(ready) ?? projects[0];
  const is = (t: Tab) => tab === t;

  return (
    <View accessibilityRole="tablist" style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.14)' }, glass]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: TAB_BAR_HEIGHT, paddingHorizontal: 4 }}>
        <Item label="Home" on={is('home')} onPress={() => open('/', path)} Icon={HomeGlyph} />
        <Item label="Vault" on={is('vault')} onPress={() => open('/vault', path)} Icon={VaultGlyph} />
        <View style={{ width: 76, height: TAB_BAR_HEIGHT, alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={beat ? `Freestyle over ${beat.name}` : 'Add a beat to freestyle'}
            accessibilityState={{ disabled: !beat }}
            disabled={!beat}
            hitSlop={6}
            onPress={() => {
              if (!beat) return;
              setCurrent(beat.id);
              open('/vocals', path);
            }}
            style={({ pressed }) => ({
              position: 'absolute',
              top: -18,
              width: 62,
              height: 62,
              borderRadius: 31,
              backgroundColor: beat ? C.accent : C.dim,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 0.5,
              borderColor: 'rgba(255,255,255,0.28)',
              boxShadow: beat ? '0 8px 22px rgba(255,176,32,0.28), 0 2px 6px rgba(0,0,0,0.5)' : '0 2px 6px rgba(0,0,0,0.5)',
              transform: [{ scale: pressed ? 0.93 : 1 }],
            })}
          >
            <MicIcon size={28} color={beat ? C.bg : C.muted} />
          </Pressable>
        </View>
        <Item
          label="Player"
          on={is('player')}
          disabled={!playable && !is('player')}
          onPress={() => {
            if (!playable) return;
            setCurrent(playable.id);
            open('/player', path);
          }}
          Icon={PlayerGlyph}
        />
        <Item label="Settings" on={is('settings')} onPress={() => open('/settings', path)} Icon={SettingsGlyph} />
      </View>
    </View>
  );
}
