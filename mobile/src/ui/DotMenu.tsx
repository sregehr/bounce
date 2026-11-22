import { useRef, useState, type ComponentRef } from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Txt } from './kit';
import { Pop } from './motion';
import { C } from './theme';

export type MenuItem = {
  label: string;
  onPress: () => void;
  /** Asks "Sure?" on the first tap and only acts on the second, for things that cannot be undone. */
  confirm?: boolean;
  /** Shown in red without asking first, for a removal that can be undone. */
  danger?: boolean;
};

/**
 * Three dots that open a short menu beside them, for the lesser things a row can do. It opens
 * over everything else, so a list that scrolls or clips does not cut it off.
 */
export function DotMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const window = useWindowDimensions();
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const [sure, setSure] = useState<string | null>(null);

  const close = () => {
    setAt(null);
    setSure(null);
  };
  const open = () =>
    ref.current?.measureInWindow((x, y, w, h) => {
      // Below the dots when there is room, above them near the bottom of the screen.
      const height = items.length * 46 + 12;
      const top = y + h + height + 8 > window.height ? Math.max(8, y - height) : y + h;
      setAt({ top, right: Math.max(8, window.width - (x + w)) });
    });
  const choose = (item: MenuItem) => {
    if (item.confirm && sure !== item.label) return setSure(item.label);
    close();
    item.onPress();
  };

  return (
    <>
      <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: !!at }} onPress={open} hitSlop={6} style={({ pressed }) => ({ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}>
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Circle cx={5} cy={12} r={1.9} fill={C.muted} />
          <Circle cx={12} cy={12} r={1.9} fill={C.muted} />
          <Circle cx={19} cy={12} r={1.9} fill={C.muted} />
        </Svg>
      </Pressable>
      <Modal visible={!!at} transparent animationType="none" onRequestClose={close}>
        {/* A tap anywhere else puts the menu away. */}
        <Pressable accessibilityLabel="Close menu" onPress={close} style={{ flex: 1 }}>
          {at && (
            // It grows out of the dots that opened it.
            <Pop style={{ position: 'absolute', top: at.top, right: at.right }}>
            <View accessibilityRole="menu" style={{ minWidth: 180, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, paddingVertical: 6, boxShadow: '0 12px 32px rgba(0,0,0,0.55)' }}>
              {items.map((item) => (
                <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={sure === item.label ? `Sure? ${item.label}` : item.label} onPress={() => choose(item)} style={({ pressed }) => ({ minHeight: 46, paddingHorizontal: 16, justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}>
                  <Txt size={16} w="medium" color={item.confirm || item.danger ? C.recText : C.text}>
                    {sure === item.label ? `Sure? ${item.label}` : item.label}
                  </Txt>
                </Pressable>
              ))}
            </View>
            </Pop>
          )}
        </Pressable>
      </Modal>
    </>
  );
}
