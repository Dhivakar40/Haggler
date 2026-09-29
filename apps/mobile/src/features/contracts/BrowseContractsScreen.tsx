import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { useCategories } from '../../api/hooks';
import { useBrowseContracts } from '../../api/contracts';
import { Card, Chip, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

/** Ranger-facing: browse OPEN Contract-labour listings (Phase 6). No push/digest exists yet for
 * new postings matching a Ranger's categories (D-059) — this screen is the only way to find one. */
export function BrowseContractsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
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
        <ErrorState onRetry={() => void listings.refetch()} />
      </Screen>
    );

  const items = listings.data?.items ?? [];

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
          renderItem={({ item }) => (
            <Card
              testID={`browse-listing-${item.id}`}
              onPress={() => router.push(`/contracts/${item.id}`)}
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
                  {formatRupees(item.payAmountPaise)} / {t(`employer.payTypes.${item.payType}`)}
                </Text>
                {item.myApplicationStatus ? (
                  <Text color="success" testID={`browse-listing-${item.id}-status`}>
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
