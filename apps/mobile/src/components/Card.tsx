import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { elevatedShadow, MIN_TOUCH_TARGET, radii, spacing } from '../theme/tokens';

interface CardProps {
  children: ReactNode;
  style?: ViewStyle;
  /** When set the card is a button; the label is read by screen readers. */
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  /** Raises the card above the page with a real shadow. Reserved for a surface that needs the
   * user's attention right now (an active job, an incoming request, a price to confirm) — see the
   * elevation policy in theme/tokens.ts. Flat (the default) everywhere else. */
  elevated?: boolean;
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  testID,
  elevated = false,
}: CardProps) {
  const { colors } = useTheme();
  const base = [
    styles.card,
    { backgroundColor: colors.surface, borderColor: colors.border },
    elevated && { borderColor: colors.primary, ...elevatedShadow },
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
