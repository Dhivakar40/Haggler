import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useCategories } from '../../api/hooks';
import { Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

/**
 * Lists the real service categories from GET /v1/categories.
 * Tapping a category will start a request in Phase 2 (requires sign-in, Phase 1), so the
 * cards are not pressable yet: no button that does nothing.
 */
export function HomeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { data, isLoading, isError, refetch } = useCategories();

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xs }}>
        <Text variant="title">{t('home.title')}</Text>
        <Text color="textMuted">{t('home.subtitle')}</Text>
      </View>

      {isLoading && <LoadingState />}
      {isError && <ErrorState onRetry={() => void refetch()} />}
      {data && data.length === 0 && <EmptyState />}

      <View style={styles.grid}>
        {data?.map((c) => (
          <Card key={c.id} testID={`category-${c.slug}`} style={styles.tile}>
            <Ionicons
              name={c.icon as keyof typeof Ionicons.glyphMap}
              size={28}
              color={colors.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text variant="label">{t(c.nameKey)}</Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '47%', alignItems: 'flex-start', gap: spacing.sm, minHeight: 96 },
});
