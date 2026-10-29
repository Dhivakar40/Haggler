import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useCategories } from '../../api/hooks';
import { useSession } from '../../auth/session';
import { EmptyState, ErrorState, Screen, Skeleton, Text } from '../../components';
import { formatRupees } from '../../lib/money';
import { firstName } from '../../lib/name';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';
import { CategoryTile, HOME_GRID_LIMIT, TILE_TINTS, TILE_TINTS_DARK } from './CategoryTile';

const SLIDE_WIDTH = Dimensions.get('window').width - spacing.lg * 2;

const HERO_SLIDES = ['hero1', 'hero2', 'hero3'] as const;

/**
 * MOCK DATA (D-114) — standing in for a sub-service catalog, photos, price ranges and ratings
 * that do not exist anywhere in the app yet, by explicit product-owner instruction ("replicate
 * the section with mock data... we'll build the real pipeline later"). Everything else about this
 * card is real: `categorySlug` points at a real category and tapping one opens a genuine new
 * service request for it — only the photo/price-range/rating are placeholders. Do not read these
 * numbers as real pricing or review data anywhere else in the app.
 */
const MOCK_POPULAR_SERVICES = [
  {
    id: 'mock-ac-installation',
    nameKey: 'home.popularAcInstallation',
    categorySlug: 'ac_repair',
    icon: 'snow-outline' as const,
    minPaise: 80_000,
    maxPaise: 120_000,
    rating: 4.8,
    reviewCount: 120,
  },
  {
    id: 'mock-room-cleaning',
    nameKey: 'home.popularRoomCleaning',
    categorySlug: 'cleaner',
    icon: 'sparkles-outline' as const,
    minPaise: 30_000,
    maxPaise: 50_000,
    rating: 4.7,
    reviewCount: 98,
  },
  {
    id: 'mock-furniture-assembly',
    nameKey: 'home.popularFurnitureAssembly',
    categorySlug: 'carpenter',
    icon: 'hammer-outline' as const,
    minPaise: 50_000,
    maxPaise: 80_000,
    rating: 4.6,
    reviewCount: 76,
  },
] as const;

function matches(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.trim().toLowerCase());
}

export function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, scheme } = useTheme();
  const { data, isLoading, isError, error, refetch } = useCategories();
  const name = useSession((s) => firstName(s.user?.fullName));
  const [query, setQuery] = useState('');
  const [heroIndex, setHeroIndex] = useState(0);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView>(null);
  const tints = scheme === 'dark' ? TILE_TINTS_DARK : TILE_TINTS;

  const trimmedQuery = query.trim();
  const visibleCategories = (data ?? []).filter(
    (cat) => !trimmedQuery || matches(t(cat.nameKey), trimmedQuery),
  );
  const visiblePopular = MOCK_POPULAR_SERVICES.filter(
    (svc) => !trimmedQuery || matches(t(svc.nameKey), trimmedQuery),
  );

  function toggleLike(id: string) {
    setLikedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="title">{name ? t('home.titleNamed', { name }) : t('home.title')}</Text>
          <Text color="textMuted" style={styles.subtitle}>
            {t('home.subtitle')}
          </Text>
        </View>
        <Pressable
          testID="home-notifications"
          accessibilityRole="button"
          accessibilityLabel={t('settings.notifications')}
          onPress={() => router.push('/settings')}
          style={[styles.bellButton, { backgroundColor: colors.surfaceAlt }]}
          hitSlop={8}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          testID="home-search"
          accessibilityLabel={t('home.searchPlaceholder')}
          placeholder={t('home.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          style={[styles.searchInput, { color: colors.text }]}
        />
      </View>

      <View>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) =>
            setHeroIndex(Math.round(e.nativeEvent.contentOffset.x / SLIDE_WIDTH))
          }
        >
          {HERO_SLIDES.map((key) => (
            <View
              key={key}
              style={[styles.heroSlide, { backgroundColor: colors.surfaceAlt, width: SLIDE_WIDTH }]}
            >
              <View style={styles.heroIcon}>
                <Ionicons name="shield-checkmark-outline" size={28} color={colors.primary} />
              </View>
              <Text variant="heading">{t(`home.${key}Title`)}</Text>
              <Text color="textMuted">{t(`home.${key}Subtitle`)}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.dotsRow}>
          {HERO_SLIDES.map((key, i) => (
            <View
              key={key}
              style={[
                styles.dot,
                { backgroundColor: i === heroIndex ? colors.primary : colors.border },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.sectionHeadingRow}>
        <Text variant="heading">{t('home.categoriesHeading')}</Text>
        <Pressable
          testID="home-see-all-categories"
          accessibilityRole="button"
          onPress={() => router.push('/categories')}
        >
          <View style={styles.seeAllRow}>
            <Text color="primary" variant="label">
              {t('home.seeAll')}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </View>
        </Pressable>
      </View>

      {isLoading && (
        <View style={styles.grid} testID="home-skeleton">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <View
              key={i}
              style={[
                styles.skeletonTile,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Skeleton width={44} height={44} radius={14} />
              <Skeleton width="70%" height={12} />
            </View>
          ))}
        </View>
      )}

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {data && visibleCategories.length === 0 && <EmptyState />}

      {data && visibleCategories.length > 0 && (
        <View style={styles.grid}>
          {visibleCategories.slice(0, HOME_GRID_LIMIT).map((cat, i) => (
            <CategoryTile key={cat.id} category={cat} tint={tints[i % tints.length]!} />
          ))}
        </View>
      )}

      {visiblePopular.length > 0 ? (
        <>
          <View style={styles.sectionHeadingRow}>
            <Text variant="heading">{t('home.popularHeading')}</Text>
          </View>
          <View style={styles.popularList}>
            {visiblePopular.map((svc, i) => {
              const tint = tints[i % tints.length]!;
              const liked = likedIds.has(svc.id);
              return (
                <Pressable
                  key={svc.id}
                  testID={`popular-service-${svc.id}`}
                  accessibilityLabel={t(svc.nameKey)}
                  onPress={() =>
                    router.push({
                      pathname: '/request/new',
                      params: { category: svc.categorySlug },
                    })
                  }
                  style={[styles.popularCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={[styles.popularPhoto, { backgroundColor: tint.bg }]}>
                    <Ionicons name={svc.icon} size={32} color={tint.fg} />
                    <Pressable
                      testID={`popular-like-${svc.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={t('home.save')}
                      accessibilityState={{ selected: liked }}
                      onPress={() => toggleLike(svc.id)}
                      hitSlop={8}
                      style={styles.likeButton}
                    >
                      <Ionicons
                        name={liked ? 'heart' : 'heart-outline'}
                        size={16}
                        color={liked ? colors.danger : colors.textMuted}
                      />
                    </Pressable>
                  </View>
                  <View style={styles.popularBody}>
                    <Text variant="label" numberOfLines={1}>
                      {t(svc.nameKey)}
                    </Text>
                    <Text variant="caption" color="textMuted">
                      {t(`categories.${svc.categorySlug}`)}
                    </Text>
                    <Text variant="caption">
                      {formatRupees(svc.minPaise)} - {formatRupees(svc.maxPaise)}
                    </Text>
                    <View style={styles.ratingRow}>
                      <Ionicons name="star" size={13} color={colors.warning} />
                      <Text variant="caption">{svc.rating.toFixed(1)}</Text>
                      <Text variant="caption" color="textMuted">
                        {t('home.reviewCount', { count: svc.reviewCount })}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  headerText: { flex: 1, gap: spacing.xs },
  subtitle: { lineHeight: 23 },
  bellButton: {
    width: 42,
    height: 42,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    height: 48,
  },
  searchInput: { flex: 1, fontSize: 16, height: '100%' },
  heroSlide: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  heroIcon: { marginBottom: spacing.xs },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  dot: { width: 6, height: 6, borderRadius: radii.pill },
  sectionHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  seeAllRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
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
  popularList: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md },
  popularCard: {
    width: '31.5%',
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  popularPhoto: { height: 72, alignItems: 'center', justifyContent: 'center' },
  likeButton: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popularBody: { padding: spacing.sm, gap: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
});
