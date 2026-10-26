import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { useCategories } from '../../api/hooks';
import { useBrowseContracts } from '../../api/contracts';
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  PriceTag,
  Screen,
  StatusPill,
  Text,
  type StatusTone,
} from '../../components';
import { applicationStatusTone } from '../../lib/status-tone';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

const FALLBACK_ICON: keyof typeof Ionicons.glyphMap = 'briefcase-outline';

/** Ranger-facing: browse OPEN Contract-labour listings (Phase 6). No push/digest exists yet for
 * new postings matching a Ranger's categories (D-059) — this screen is the only way to find one.
 * D-105: redesigned from a plain text-in-a-box list to use the same visual language (icons,
 * StatusPill, PriceTag, Badge) as the rest of the app instead of looking like a different app. */
export function BrowseContractsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const categories = useCategories();
  const [categorySlug, setCategorySlug] = useState<string>();
  const listings = useBrowseContracts({ categorySlug });

  if (listings.isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (listings.isError)
    return (
      <Screen>
        <ErrorState error={listings.error} onRetry={() => void listings.refetch()} />
      </Screen>
    );

  const items = listings.data?.items ?? [];
  const categoryIcon = (slug: string): keyof typeof Ionicons.glyphMap => {
    const icon = categories.data?.find((c) => c.slug === slug)?.icon;
    return icon && icon in Ionicons.glyphMap ? (icon as keyof typeof Ionicons.glyphMap) : FALLBACK_ICON;
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Chip
          testID="browse-cat-all"
          label={t('employer.allCategories')}
          selected={!categorySlug}
          onPress={() => setCategorySlug(undefined)}
        />
        {categories.data?.map((c) => (
          <Chip
            key={c.slug}
            testID={`browse-cat-${c.slug}`}
            label={t(c.nameKey)}
            selected={categorySlug === c.slug}
            onPress={() => setCategorySlug(c.slug)}
          />
        ))}
      </View>
      {items.length === 0 ? (
        <EmptyState message={t('employer.noOpenListings')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}
          renderItem={({ item }) => {
            const spotsLeft = item.openings - item.filledCount;
            const spotsTone: StatusTone = spotsLeft <= 1 ? 'warning' : 'neutral';
            return (
              <Card
                testID={`browse-listing-${item.id}`}
                onPress={() => router.push(`/contracts/${item.id}`)}
              >
                <View style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
                    <Ionicons
                      name={categoryIcon(item.categorySlug)}
                      size={22}
                      color={colors.primary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="heading">{item.title}</Text>
                      <Text color="textMuted">
                        {item.businessName} · {t(`categories.${item.categorySlug}`)}
                      </Text>
                    </View>
                    {item.isBoosted ? (
                      <Badge testID={`browse-listing-${item.id}-boosted`} label={t('employer.boosted')} tone="accent" />
                    ) : null}
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                    <Text color="textMuted">
                      {item.city}, {item.state}
                    </Text>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <PriceTag paise={item.payAmountPaise} testID={`browse-listing-${item.id}-pay`} />
                    <Text color="textMuted">/ {t(`employer.payTypes.${item.payType}`)}</Text>
                  </View>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    <StatusPill
                      testID={`browse-listing-${item.id}-spots`}
                      tone={spotsTone}
                      label={t('employer.filledOf', {
                        filled: item.filledCount,
                        openings: item.openings,
                      })}
                    />
                    {item.myApplicationStatus ? (
                      <StatusPill
                        testID={`browse-listing-${item.id}-status`}
                        tone={applicationStatusTone(item.myApplicationStatus)}
                        label={t(`employer.applicationStatus.${item.myApplicationStatus}`)}
                      />
                    ) : null}
                  </View>
                </View>
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}
