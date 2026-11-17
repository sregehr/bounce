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
import { closeInput, useEngine } from '@/engine/engine';
import { TabBar, TopNav } from '@/ui/TabBar';
import { useGuarded } from '@/ui/guard';
import { Btn, Muted, Txt } from '@/ui/kit';
import { C } from '@/ui/theme';
import { WIDE_MAX, useRoomy, useWide } from '@/ui/wide';

// How a sheet is presented. The phone has its own: it rises from the bottom, the screen behind
// steps back, and a swipe down closes it. A browser has none, so there the screen is laid over
// the one before with nothing behind it, and `asSheet` (see `nav.tsx`) draws the sheet itself.
const sheetOptions = (held: boolean) =>
  Platform.OS === 'web' ? ({ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } } as const) : ({ presentation: 'modal', gestureEnabled: !held } as const);

// Screens anyone can open before the welcome is done.
const OPEN = ['/onboarding', '/privacy'];
const LISTENING = ['/onboarding', '/capture', '/record', '/vocals'];

export default function Layout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold });
  const ready = useReady();
  const loadError = useLoadError();
  // While a take or a capture is running, the swipe back from the screen edge is off: it would drop the recording.
  // The same holds while one is being saved, or is held because it could not be: the record screens say so through the guard.
  const guarded = useGuarded();
  const live = useEngine((e) => e.take.mode !== 'idle' || e.capture.status === 'recording') || guarded;
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

  // A tablet on its side, or a wide browser window, gets the two-pane layout.
  const wide = useWide();
  // A tablet held upright, or a window about that size, uses its whole width with the content in a column down the middle.
  const roomy = useRoomy();
  // A tall desktop browser window between the two shows the app in a phone-sized frame, as the original design does.
  // A touch screen never gets the frame: there it would be a tablet sharing its screen, drawn as a phone in a box.
  const touch = Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const framed = !wide && !roomy && !touch && Platform.OS === 'web' && width >= 520 && height >= 880;
  const loaded = ready && (fontsLoaded || !!fontError);
  // A sheet cannot be swiped away either while the screen in view is holding a recording.
  const SHEET = sheetOptions(live);

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
              <Stack screenOptions={{ title: 'Bounce', headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
                {/* Drilling in pushes from the right, as it does everywhere on the phone: Home to Capture to Record, a song to its mastering, Settings to Privacy. Tabs cross-fade. */}
                {['capture', 'master', 'privacy'].map((name) => (
                  <Stack.Screen key={name} name={name} options={{ animation: 'slide_from_right' }} />
                ))}
                <Stack.Screen name="record" options={{ animation: 'slide_from_right', gestureEnabled: !live }} />
                <Stack.Screen name="vocals" options={{ gestureEnabled: !live }} />
                {/* Tasks you step out to and come back from are sheets over the screen that opened them. */}
                {['cover', 'export', 'snippet', 'demos'].map((name) => (
                  <Stack.Screen key={name} name={name} options={SHEET} />
                ))}
                {/* The welcome is a full screen the first time; opened again from the mic screen it is a sheet. */}
                <Stack.Screen name="onboarding" options={({ route }) => ((route.params as { setup?: string } | undefined)?.setup ? SHEET : {})} />
                {/* The player rises over the Vault and is swiped back down. On the phone it covers the whole screen, as a music player does. */}
                <Stack.Screen name="player" options={Platform.OS === 'web' ? SHEET : { animation: 'slide_from_bottom', gestureDirection: 'vertical', gestureEnabled: !live }} />
              </Stack>
              <TopNav />
              <TabBar />
            </>
          )}
        </View>
      </View>
      </Backend>
    </SafeAreaProvider>
  );
}
