import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { useCategories } from '../../api/hooks';
import { useBrowseCampus } from '../../api/campus';
import { Card, Chip, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

/** Student-facing: browse OPEN Campus listings (Phase 7). Same "no proactive digest" gap as
 * Contract labour (D-059) — a student has to actively check back here. */
export function BrowseCampusScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const categories = useCategories();
  const [categorySlug, setCategorySlug] = useState<string>();
  const listings = useBrowseCampus({ categorySlug });

  if (listings.isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (listings.isError)
    return (
      <Screen>
        <ErrorState onRetry={() => void listings.refetch()} />
      </Screen>
    );

  const items = listings.data?.items ?? [];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Chip
          testID="campus-browse-cat-all"
          label={t('employer.allCategories')}
          selected={!categorySlug}
          onPress={() => setCategorySlug(undefined)}
        />
        {categories.data?.map((c) => (
          <Chip
            key={c.slug}
            testID={`campus-browse-cat-${c.slug}`}
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
          renderItem={({ item }) => (
            <Card
              testID={`campus-browse-listing-${item.id}`}
              onPress={() => router.push(`/campus/${item.id}`)}
            >
              <View style={{ gap: spacing.xs }}>
                <Text variant="heading">{item.title}</Text>
                <Text color="textMuted">
                  {item.businessName} · {t(`categories.${item.categorySlug}`)}
                </Text>
                <Text color="textMuted">
                  {item.city}, {item.state}
                </Text>
                <Text>
                  {formatRupees(item.hourlyRatePaise)}/{t('campus.perHour')} ·{' '}
                  {t('campus.hoursPerWeekShort', { hours: item.hoursPerWeek })}
                </Text>
                {item.isNightShift ? (
                  <Text variant="caption" color="textMuted">
                    {t('campus.nightShift')}
                  </Text>
                ) : null}
                {item.myApplicationStatus ? (
                  <Text color="success" testID={`campus-browse-listing-${item.id}-status`}>
                    {t(`employer.applicationStatus.${item.myApplicationStatus}`)}
                  </Text>
                ) : null}
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
