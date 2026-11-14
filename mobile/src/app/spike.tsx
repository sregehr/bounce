import { Platform } from 'react-native';
import { Redirect } from 'expo-router';

import SpikeScreen from '@/spike/SpikeScreen';

/** The native audio test bench from the first spike. Phone builds only. */
export default function Spike() {
  if (Platform.OS === 'web') return <Redirect href="/" />;
  return <SpikeScreen />;
}
