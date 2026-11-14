import { useEffect } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { Redirect, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startBackup } from '@/data/backup';
import { loadLibrary, useLibrary, useReady } from '@/data/store';
import { C } from '@/ui/theme';

export default function Layout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold });
  const ready = useReady();
  const onboarded = useLibrary((l) => l.profile.onboarded);
  const pathname = usePathname();
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    void loadLibrary();
    return startBackup();
  }, []);

  // On a desktop browser, show the app in a phone-sized frame, as the original design does.
  const framed = Platform.OS === 'web' && width >= 520 && height >= 880;
  const loaded = ready && (fontsLoaded || !!fontError);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: framed ? '#000' : C.bg, alignItems: framed ? 'center' : 'stretch', justifyContent: framed ? 'center' : 'flex-start' }}>
        <View style={framed ? { width: 390, height: 844, borderRadius: 32, overflow: 'hidden', backgroundColor: C.bg } : { flex: 1, backgroundColor: C.bg, width: '100%', maxWidth: 430, alignSelf: 'center' }}>
          {!loaded ? null : !onboarded && pathname !== '/onboarding' ? (
            <Redirect href="/onboarding" />
          ) : (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }} />
          )}
        </View>
      </View>
    </SafeAreaProvider>
  );
}
