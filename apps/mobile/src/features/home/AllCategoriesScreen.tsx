import { StyleSheet, View } from 'react-native';
import { useCategories } from '../../api/hooks';
import { EmptyState, ErrorState, Screen, Skeleton } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';
import { CategoryTile, TILE_TINTS, TILE_TINTS_DARK } from './CategoryTile';

/** "See All" from Home's capped category grid — the same real catalog, same tiles, just every
 * category instead of the first `HOME_GRID_LIMIT`. */
export function AllCategoriesScreen() {
  const { colors, scheme } = useTheme();
  const { data, isLoading, isError, error, refetch } = useCategories();
  const tints = scheme === 'dark' ? TILE_TINTS_DARK : TILE_TINTS;

  return (
    <Screen scroll>
      {isLoading && (
        <View style={styles.grid} testID="all-categories-skeleton">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <View
              key={i}
              style={[styles.skeletonTile, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Skeleton width={44} height={44} radius={14} />
              <Skeleton width="70%" height={12} />
            </View>
          ))}
        </View>
      )}

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {data && data.length === 0 && <EmptyState />}

      {data && data.length > 0 && (
        <View style={styles.grid}>
          {data.map((cat, i) => (
            <CategoryTile key={cat.id} category={cat} tint={tints[i % tints.length]!} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.lg,
  },
  skeletonTile: {
    width: '23%',
    minHeight: 96,
    padding: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    alignItems: 'center',
  },
});
