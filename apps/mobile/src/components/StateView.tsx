import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
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

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.box} accessibilityRole="alert">
      <Text color="danger" style={styles.center}>
        {t('states.error')}
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
