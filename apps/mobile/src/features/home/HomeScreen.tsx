import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useCategories } from '../../api/hooks';
import { EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';
import { draftLightColors, draftDarkColors } from '../../theme/tokens.draft';

/**
 * DRAFT redesign (Part 2 checkpoint): a flat service directory instead of bordered/shadowed tiles
 * — each category is a plain row (icon, name, a hairline underneath), grouped two to a line. No
 * card chrome at all here: browsing categories isn't an "action awaiting you," it's a menu, so it
 * stays flat per the elevation policy in tokens.draft.ts. Data-fetching and navigation are
 * untouched from the live HomeScreen — same query, same testIDs, same behaviour.
 */
export function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { scheme } = useTheme();
  const c = scheme === 'dark' ? draftDarkColors : draftLightColors;
  const { data, isLoading, isError, refetch } = useCategories();

  return (
    <Screen scroll style={{ backgroundColor: c.background }}>
      <View style={{ gap: spacing.xs }}>
        <Text variant="title" style={{ color: c.text }}>
          {t('home.title')}
        </Text>
        <Text style={{ color: c.textMuted }}>{t('home.subtitle')}</Text>
      </View>

      {isLoading && <LoadingState />}
      {isError && <ErrorState onRetry={() => void refetch()} />}
      {data && data.length === 0 && <EmptyState />}

      <View style={styles.grid}>
        {data?.map((cat) => (
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
              { borderColor: c.border },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons
              name={cat.icon as keyof typeof Ionicons.glyphMap}
              size={26}
              color={c.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text variant="label" style={{ color: c.text }}>
              {t(cat.nameKey)}
            </Text>
          </Pressable>
        ))}
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
