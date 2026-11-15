import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { importBeat } from '@/data/beats';
import { Muted, Screen, TopBar, Txt } from '@/ui/kit';
import { useTask } from '@/ui/hooks';
import { C } from '@/ui/theme';

/** Starting a new song: the three ways to bring a beat in. Reached from the plus in the top bar. */
export default function NewSong() {
  const task = useTask();
  const pick = () => task.run(async () => void ((await importBeat()) && router.replace('/beat')));

  const Way = ({ title, about, onPress, primary }: { title: string; about: string; onPress: () => void; primary?: boolean }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={task.busy}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: primary ? C.accent : C.surface, borderWidth: primary ? 0 : 1, borderColor: C.border, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 20, gap: 4, opacity: task.busy ? 0.5 : pressed ? 0.9 : 1 })}
    >
      <Txt size={19} w="display" ls={0} color={primary ? C.bg : C.text}>
        {title}
      </Txt>
      <Txt size={14} lh={1.4} color={primary ? C.bg : C.muted}>
        {about}
      </Txt>
    </Pressable>
  );

  return (
    <Screen gap={14}>
      <TopBar left="New song" />
      <Muted>Every song starts with a beat. Bring one in, then record over it.</Muted>
      <View style={{ gap: 12 }}>
        <Way primary title="Capture from your MPC" about="Play the beat into this device and it is recorded as it comes in." onPress={() => router.push('/capture')} />
        <Way title={task.busy ? 'Importing…' : 'Import a file'} about="An audio file you already have. Tempo and key are worked out for you." onPress={pick} />
        <Way title="Pick a demo song" about="Ready-made beats to try everything with just a microphone." onPress={() => router.push('/demos')} />
      </View>
      {task.error && (
        <Txt size={13} color={C.recText}>
          {task.error}
        </Txt>
      )}
    </Screen>
  );
}
