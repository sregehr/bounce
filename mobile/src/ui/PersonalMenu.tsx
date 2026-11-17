import { useEffect, useState } from 'react';
import { Image, Pressable, View, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';

import { useAccount } from '@/auth/account';
import { backendAvailable } from '@/auth/backend';
import { useLibrary } from '@/data/store';

import { Txt } from './kit';
import { TOP_NAV_HEIGHT } from './tabs';
import { C } from './theme';

const SIZE = 30;
const ITEMS = [
  { label: 'Profile', to: '/profile' },
  { label: 'Settings', to: '/settings' },
] as const;

/** The round button: your picture when signed in, else your initial, else a plain figure. */
function Face({ name, image, lit }: { name: string; image: string | null; lit: boolean }) {
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <View style={{ width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 1.5, borderColor: lit ? C.accent : C.borderStrong, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {image ? (
        <Image source={{ uri: image }} style={{ width: SIZE, height: SIZE }} />
      ) : initial ? (
        <Txt size={14} w="semi" color={lit ? C.accent : C.text}>
          {initial}
        </Txt>
      ) : (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={8.5} r={3.6} stroke={lit ? C.accent : C.muted} strokeWidth={1.8} />
          <Path d="M5 19.5c1.2-3.2 3.8-4.8 7-4.8s5.8 1.6 7 4.8" stroke={lit ? C.accent : C.muted} strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
      )}
    </View>
  );
}

function Menu({ name, image, onNavigate }: Props & { name: string; image: string | null }) {
  const path = usePathname();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const here = ITEMS.some((item) => item.to === path);

  // Going anywhere closes it.
  useEffect(() => setOpen(false), [path]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Your menu"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}
      >
        <Face name={name} image={image} lit={open || here} />
      </Pressable>
      {open && (
        <>
          {/* A tap anywhere else puts the menu away. */}
          <Pressable accessibilityLabel="Close menu" onPress={() => setOpen(false)} style={{ position: 'absolute', top: -200, right: -40, width: 4000, height: height + 400 }} />
          <View accessibilityRole="menu" style={{ position: 'absolute', top: TOP_NAV_HEIGHT - 2, right: 0, minWidth: 180, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, paddingVertical: 6, boxShadow: '0 12px 32px rgba(0,0,0,0.55)' }}>
            {ITEMS.map((item) => (
              <Pressable
                key={item.to}
                accessibilityRole="link"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: path === item.to }}
                onPress={() => (setOpen(false), onNavigate(item.to))}
                style={({ pressed }) => ({ minHeight: 46, paddingHorizontal: 16, justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}
              >
                <Txt size={16} w="medium" color={path === item.to ? C.accent : C.text}>
                  {item.label}
                </Txt>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </>
  );
}

type Props = { onNavigate: (to: (typeof ITEMS)[number]['to']) => void };

/** Shows the signed-in person. Only rendered when the build has a server, which the account needs. */
function SignedMenu(props: Props) {
  const artist = useLibrary((l) => l.profile.artist);
  const { me } = useAccount();
  return <Menu {...props} name={me?.name || artist} image={me?.image ?? null} />;
}

/** The personal menu at the right of the top bar: Profile and Settings. */
export function PersonalMenu(props: Props) {
  const artist = useLibrary((l) => l.profile.artist);
  if (backendAvailable) return <SignedMenu {...props} />;
  return <Menu {...props} name={artist} image={null} />;
}
