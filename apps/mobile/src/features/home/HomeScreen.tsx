import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useCategories } from '../../api/hooks';
import { useSession } from '../../auth/session';
import { Card, EmptyState, ErrorState, Screen, Skeleton, Text } from '../../components';
import { firstName } from '../../lib/name';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

const FALLBACK_ICON: keyof typeof Ionicons.glyphMap = 'ellipsis-horizontal-circle-outline';

export function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const { data, isLoading, isError, error, refetch } = useCategories();
  const name = useSession((s) => firstName(s.user?.fullName));

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text variant="title">{name ? t('home.titleNamed', { name }) : t('home.title')}</Text>
        <Text color="textMuted" style={styles.subtitle}>
          {t('home.subtitle')}
        </Text>
      </View>

      {isLoading && (
        <View style={styles.grid} testID="home-skeleton">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View
              key={i}
              style={[
                styles.skeletonTile,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Skeleton width={46} height={46} radius={14} />
              <View style={styles.skeletonText}>
                <Skeleton width="82%" height={16} />
                <Skeleton width="48%" height={12} />
              </View>
            </View>
          ))}
        </View>
      )}

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {data && data.length === 0 && <EmptyState />}

      {data && data.length > 0 && (
        <View style={styles.grid}>
          {data.map((cat) => {
            const iconName =
              cat.icon in Ionicons.glyphMap
                ? (cat.icon as keyof typeof Ionicons.glyphMap)
                : FALLBACK_ICON;

            return (
              <Card
                key={cat.id}
                testID={`category-${cat.slug}`}
                accessibilityLabel={t(cat.nameKey)}
                onPress={() =>
                  router.push({ pathname: '/request/new', params: { category: cat.slug } })
                }
                style={styles.tile}
              >
                <View style={[styles.iconShell, { backgroundColor: colors.surfaceAlt }]}>
                  <Ionicons
                    name={iconName}
                    size={26}
                    color={colors.primary}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                </View>

                <View style={styles.tileFooter}>
                  <Text variant="label" numberOfLines={2} style={styles.categoryName}>
                    {t(cat.nameKey)}
                  </Text>

                  <Ionicons
                    name="arrow-forward-circle-outline"
                    size={21}
                    color={colors.textMuted}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  subtitle: {
    lineHeight: 23,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  tile: {
    width: '48%',
    minHeight: 132,
    padding: spacing.md,
    borderRadius: radii.lg,
    justifyContent: 'space-between',
  },
  iconShell: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  categoryName: {
    flex: 1,
    lineHeight: 20,
  },
  skeletonTile: {
    width: '48%',
    minHeight: 132,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    justifyContent: 'space-between',
  },
  skeletonText: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
