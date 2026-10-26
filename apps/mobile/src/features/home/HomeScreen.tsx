import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useCategories } from '../../api/hooks';
import { EmptyState, ErrorState, Screen, Skeleton, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

const FALLBACK_ICON: keyof typeof Ionicons.glyphMap = 'ellipsis-horizontal-circle-outline';

/** A flat service directory: each category is a plain row (icon, name, a hairline underneath),
 * not a bordered/shadowed tile — browsing categories is a menu, not an action awaiting you, so it
 * stays flat per the elevation policy in theme/tokens.ts. */
export function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const { data, isLoading, isError, error, refetch } = useCategories();

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xs }}>
        <Text variant="title">{t('home.title')}</Text>
        <Text color="textMuted">{t('home.subtitle')}</Text>
      </View>

      {isLoading ? (
        <View style={styles.grid} testID="home-skeleton">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={styles.tile}>
              <Skeleton width={26} height={26} radius={13} />
              <Skeleton width="60%" height={16} />
            </View>
          ))}
        </View>
      ) : null}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.length === 0 && <EmptyState />}

      <View style={styles.grid}>
        {data?.map((cat) => {
          const iconName =
            cat.icon in Ionicons.glyphMap ? (cat.icon as keyof typeof Ionicons.glyphMap) : FALLBACK_ICON;
          return (
            <Pressable
              key={cat.id}
              testID={`category-${cat.slug}`}
              accessibilityRole="button"
              accessibilityLabel={t(cat.nameKey)}
              onPress={() =>
                router.push({ pathname: '/request/new', params: { category: cat.slug } })
              }
              style={({ pressed }) => [
                styles.tile,
                { borderColor: colors.border },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Ionicons
                name={iconName}
                size={26}
                color={colors.primary}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text variant="label">{t(cat.nameKey)}</Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // No border box, no shadow — just a hairline under each row (borderBottomWidth on a half-width
  // cell reads as a divided list, not a grid of cards).
  tile: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingRight: spacing.md,
    borderBottomWidth: 1,
    minHeight: 56,
  },
});
