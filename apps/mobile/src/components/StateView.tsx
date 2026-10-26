import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../lib/errors';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

/** One place for the three non-happy states every list screen needs. */
export function LoadingState() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View
      style={styles.box}
      accessibilityRole="progressbar"
      accessibilityLabel={t('states.loading')}
    >
      <ActivityIndicator color={colors.primary} size="large" />
      <Text color="textMuted">{t('states.loading')}</Text>
    </View>
  );
}

/** D-102: pass the query's own `error` so this shows what actually went wrong (e.g. "you don't
 * have access to this") instead of always claiming a connection problem — a 403 or a bad
 * response was getting shown as "check your connection" even on a perfectly good connection. */
export function ErrorState({ onRetry, error }: { onRetry: () => void; error?: unknown }) {
  const { t } = useTranslation();
  return (
    <View style={styles.box} accessibilityRole="alert">
      <Text color="danger" style={styles.center}>
        {error !== undefined ? errorMessage(error, t) : t('states.error')}
      </Text>
      <Button title={t('states.retry')} variant="secondary" onPress={onRetry} />
    </View>
  );
}

export function EmptyState({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.box}>
      <Text color="textMuted" style={styles.center}>
        {message ?? t('states.empty')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  center: { textAlign: 'center' },
});
