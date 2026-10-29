import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ServiceCategoryDto } from '@haggler/shared';
import { Text } from '../../components';
import { radii, spacing } from '../../theme/tokens';

export const FALLBACK_ICON: keyof typeof Ionicons.glyphMap = 'ellipsis-horizontal-circle-outline';

/** How many of the real categories Home shows before "See All" (`/categories`) takes over —
 * matches the design image's 4x2 grid. */
export const HOME_GRID_LIMIT = 8;

export interface TileTint {
  bg: string;
  fg: string;
}

/** Decorative only — picked per tile by position, not tied to any category's identity, purely to
 * match the design image's multi-coloured grid instead of one flat tint for every tile. */
export const TILE_TINTS: TileTint[] = [
  { bg: '#FDE2E1', fg: '#C8433C' },
  { bg: '#DFF3E3', fg: '#2F8F55' },
  { bg: '#E1EAFD', fg: '#3B69C9' },
  { bg: '#FDEFD9', fg: '#B8791F' },
  { bg: '#E9E1FD', fg: '#6E4FC2' },
  { bg: '#DFF6F3', fg: '#1C9284' },
  { bg: '#E5F5D9', fg: '#55902A' },
  { bg: '#ECECEC', fg: '#63666B' },
];

export const TILE_TINTS_DARK: TileTint[] = [
  { bg: '#402523', fg: '#F2A8A3' },
  { bg: '#1C3322', fg: '#8FDB9F' },
  { bg: '#202B47', fg: '#9FB8F2' },
  { bg: '#3F3119', fg: '#F2C98A' },
  { bg: '#2E2547', fg: '#C7B2F2' },
  { bg: '#1B332F', fg: '#8FDED1' },
  { bg: '#27331D', fg: '#B6E089' },
  { bg: '#2E2E2E', fg: '#C2C2C2' },
];

/** One category tile — the real catalog (`useCategories`), restyled to the design image's
 * centered icon-over-label grid. Shared by `HomeScreen` (capped to `HOME_GRID_LIMIT`) and the
 * "See All" destination so both stay visually and behaviourally identical. */
export function CategoryTile({ category, tint }: { category: ServiceCategoryDto; tint: TileTint }) {
  const { t } = useTranslation();
  const router = useRouter();
  const iconName =
    category.icon in Ionicons.glyphMap ? (category.icon as keyof typeof Ionicons.glyphMap) : FALLBACK_ICON;

  return (
    <Pressable
      testID={`category-${category.slug}`}
      accessibilityRole="button"
      accessibilityLabel={t(category.nameKey)}
      onPress={() => router.push({ pathname: '/request/new', params: { category: category.slug } })}
      style={styles.tile}
    >
      <View style={[styles.iconShell, { backgroundColor: tint.bg }]}>
        <Ionicons
          name={iconName}
          size={24}
          color={tint.fg}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </View>
      <Text variant="caption" numberOfLines={2} style={styles.label}>
        {t(category.nameKey)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '23%',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconShell: {
    width: 52,
    height: 52,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { textAlign: 'center' },
});
