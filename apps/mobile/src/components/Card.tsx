import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH_TARGET, radii, spacing } from '../theme/tokens';

interface CardProps {
  children: ReactNode;
  style?: ViewStyle;
  /** When set the card is a button; the label is read by screen readers. */
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

export function Card({ children, style, onPress, accessibilityLabel, testID }: CardProps) {
  const { colors } = useTheme();
  const base = [
    styles.card,
    { backgroundColor: colors.surface, borderColor: colors.border },
    style,
  ];
  if (!onPress) {
    return (
      <View testID={testID} style={base}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [...base, pressed && { opacity: 0.85 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
});
