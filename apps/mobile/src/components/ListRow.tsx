import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH_TARGET, spacing } from '../theme/tokens';
import { Text } from './Text';

interface ListRowProps {
  title: string;
  subtitle?: string;
  /** An Ionicons name, rendered at a consistent size/color on the leading edge. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Replaces the default chevron (shown automatically when onPress is set and trailing is
   * omitted) — a value, a Badge, a StatusPill, anything short. */
  trailing?: ReactNode;
  onPress?: () => void;
  tone?: 'default' | 'danger';
  testID?: string;
  accessibilityLabel?: string;
  /** "button" (default) for a navigating/acting row; "radio" for one option in a single-choice
   * list (e.g. picking a saved address) — pair with `selected` so assistive tech announces state. */
  accessibilityRole?: 'button' | 'radio';
  selected?: boolean;
}

/** The one tappable-row pattern for the whole app: a settings menu item, an address, an
 * activity/application list entry. Replaces the one-off Pressable+Ionicons row built inline in
 * NewRequestScreen.tsx's address picker and the unstructured button stack in AccountScreen.tsx
 * (docs/UI_AUDIT.md §11.1, §11.10). */
export function ListRow({
  title,
  subtitle,
  icon,
  trailing,
  onPress,
  tone = 'default',
  testID,
  accessibilityLabel,
  accessibilityRole = 'button',
  selected,
}: ListRowProps) {
  const { colors } = useTheme();
  const fg = tone === 'danger' ? colors.danger : colors.text;
  const content = (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={22} color={fg} style={styles.icon} /> : null}
      <View style={styles.text}>
        <Text style={{ color: fg }}>{title}</Text>
        {subtitle ? (
          <Text variant="caption" color="textMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null)}
    </View>
  );
  if (!onPress)
    return (
      <View testID={testID} style={[styles.base, { borderBottomColor: colors.border }]}>
        {content}
      </View>
    );
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      style={({ pressed }) => [
        styles.base,
        { borderBottomColor: colors.border },
        pressed && { opacity: 0.6 },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', borderBottomWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  icon: { width: 24, textAlign: 'center' },
  text: { flex: 1, gap: spacing.xs },
});
