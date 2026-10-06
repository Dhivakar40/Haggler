import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radii, spacing } from '../theme/tokens';
import { Text } from './Text';

interface BadgeProps {
  label: string;
  /** `accent` is for a role/identity marker (e.g. "Ranger" next to a name); `neutral` is for a
   * passive count or secondary tag. Neither implies success/failure — see StatusPill for that. */
  tone?: 'accent' | 'neutral';
  testID?: string;
}

/** A small, non-interactive label — a role marker or a count, never a status or a choice. */
export function Badge({ label, tone = 'neutral', testID }: BadgeProps) {
  const { colors } = useTheme();
  const bg = tone === 'accent' ? colors.primary : colors.surfaceAlt;
  const fg = tone === 'accent' ? colors.onPrimary : colors.textMuted;
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: bg }]}>
      <Text variant="caption" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
});
