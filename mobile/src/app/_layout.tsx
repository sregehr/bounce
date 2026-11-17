import { useEffect } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { Redirect, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Backend } from '@/auth/Provider';
import { startBackup } from '@/data/backup';
import { loadLibrary, useLibrary, useLoadError, useReady } from '@/data/store';
import { closeInput } from '@/engine/engine';
import { Rail, TabBar, TopNav } from '@/ui/TabBar';
import { Btn, Muted, Txt } from '@/ui/kit';
import { C } from '@/ui/theme';
import { WIDE_MAX, useRoomy, useWide } from '@/ui/wide';

// Screens anyone can open before the welcome is done.
const OPEN = ['/onboarding', '/privacy'];
const LISTENING = ['/onboarding', '/capture', '/record', '/vocals'];

export default function Layout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold });
  const ready = useReady();
  const loadError = useLoadError();
  const onboarded = useLibrary((l) => l.profile.onboarded);
  const pathname = usePathname();
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    void loadLibrary();
    return startBackup();
  }, []);

  // The microphone is only held open on the screens that use it.
  useEffect(() => {
    if (!LISTENING.includes(pathname)) closeInput();
  }, [pathname]);

  // A tablet on its side, or a wide browser window, gets the two-pane layout with a rail down the left.
  const wide = useWide();
  // A tablet held upright, or a window about that size, uses its whole width with the content in a column down the middle.
  const roomy = useRoomy();
  // A tall desktop browser window between the two shows the app in a phone-sized frame, as the original design does.
  // A touch screen never gets the frame: there it would be a tablet sharing its screen, drawn as a phone in a box.
  const touch = Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const framed = !wide && !roomy && !touch && Platform.OS === 'web' && width >= 520 && height >= 880;
  const loaded = ready && (fontsLoaded || !!fontError);

  return (
    <SafeAreaProvider>
      <Backend>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: framed ? '#000' : C.bg, alignItems: framed ? 'center' : 'stretch', justifyContent: framed ? 'center' : 'flex-start' }}>
        <View style={framed ? { width: 390, height: 844, borderRadius: 32, overflow: 'hidden', backgroundColor: C.bg } : { flex: 1, backgroundColor: C.bg, width: '100%', maxWidth: wide ? WIDE_MAX : roomy ? undefined : 430, alignSelf: 'center' }}>
          {loadError && !ready ? (
            // The saved songs could not be read. Carrying on would start an empty library over them.
            <View accessibilityRole="alert" style={{ flex: 1, justifyContent: 'center', padding: 32, gap: 12 }}>
              <Txt size={22} w="display" ls={0}>
                Your songs could not be opened
              </Txt>
              <Muted size={15}>Nothing has been changed or lost. Close other Bounce tabs, check that this device has free space, then try again.</Muted>
              <Muted size={13}>{loadError}</Muted>
              <Btn label="Try again" onPress={() => void loadLibrary()} style={{ flexGrow: 0, marginTop: 8 }} />
            </View>
          ) : !loaded ? null : !onboarded && !OPEN.includes(pathname) ? (
            <Redirect href="/onboarding" />
          ) : (
            <>
              <Stack screenOptions={{ title: 'Bounce', headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }} />
              {wide ? (
                <Rail />
              ) : (
                <>
                  <TopNav />
                  <TabBar />
                </>
              )}
            </>
          )}
        </View>
      </View>
      </Backend>
    </SafeAreaProvider>
  );
}
