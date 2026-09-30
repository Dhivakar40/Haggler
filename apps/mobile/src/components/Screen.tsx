import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  /** Overrides the background colour; used by screens previewing draft tokens (tokens.draft.ts)
   * before a redesign is wired into ThemeProvider itself. */
  style?: ViewStyle;
}

export function Screen({ children, scroll = false, style }: ScreenProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.background }, style]}
    >
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
      ) : (
        <View style={styles.content}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
});
