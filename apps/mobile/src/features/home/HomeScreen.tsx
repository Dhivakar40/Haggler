import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useCategories } from '../../api/hooks';
import { Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

/** Lists the real service categories from GET /v1/categories. Tapping one starts a request. */
export function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
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
          <Card
            key={c.id}
            testID={`category-${c.slug}`}
            style={styles.tile}
            accessibilityLabel={t(c.nameKey)}
            onPress={() => router.push({ pathname: '/request/new', params: { category: c.slug } })}
          >
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
