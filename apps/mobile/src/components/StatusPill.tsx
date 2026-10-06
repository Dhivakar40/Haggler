import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radii, spacing } from '../theme/tokens';
import { Text } from './Text';

export type StatusTone = 'neutral' | 'positive' | 'negative' | 'warning';

interface StatusPillProps {
  label: string;
  tone: StatusTone;
  testID?: string;
}

/** The one status-color pill for the whole app. Callers map their own domain's status string to a
 * tone (see lib/status-tone.ts) — this component only knows about the four tones, never about
 * "SHORTLISTED" vs "SCHEDULED" vs "COMPLETED_BY_WORKER" meaning the same thing in different
 * screens, which is what left six near-identical STATUS_COLOR maps scattered across the app
 * before this existed (docs/UI_AUDIT.md §11.3). */
export function StatusPill({ label, tone, testID }: StatusPillProps) {
  const { colors } = useTheme();
  const fg = {
    neutral: colors.textMuted,
    positive: colors.success,
    negative: colors.danger,
    warning: colors.warning,
  }[tone];
  return (
    <View
      testID={testID}
      style={[styles.pill, { borderColor: fg, backgroundColor: colors.surface }]}
    >
      <Text variant="caption" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
});
