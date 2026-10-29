import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH_TARGET, radii, spacing } from '../theme/tokens';
import { Text } from './Text';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'soft' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
  /** Optional leading or trailing glyph (Phase UI). Decorative only — `title` remains the
   * accessible label, so this never carries meaning on its own. */
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'leading' | 'trailing';
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityHint,
  testID,
  icon,
  iconPosition = 'leading',
}: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;

  const palette = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    danger: { bg: colors.danger, fg: colors.onDanger, border: colors.danger },
    secondary: { bg: 'transparent', fg: colors.primary, border: colors.primary },
    soft: { bg: colors.surfaceAlt, fg: colors.text, border: colors.surfaceAlt },
  }[variant];

  const iconEl = icon ? (
    <Ionicons name={icon} size={18} color={palette.fg} style={{ marginTop: -1 }} />
  ) : null;

  return (
    <Pressable
      testID={testID}
      disabled={inactive}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && !inactive && { opacity: 0.85 },
        inactive && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {iconPosition === 'leading' ? iconEl : null}
          <Text variant="label" style={{ color: palette.fg, fontSize: 16 }}>
            {title}
          </Text>
          {iconPosition === 'trailing' ? iconEl : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
