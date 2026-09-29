import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { useMyListings } from '../../api/contracts';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

const STATUS_COLOR: Record<string, 'text' | 'success' | 'danger' | 'textMuted'> = {
  OPEN: 'success',
  PAUSED: 'textMuted',
  FILLED: 'text',
  CLOSED: 'textMuted',
  CANCELLED: 'danger',
};

export function MyListingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const listings = useMyListings();

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
      <Button
        testID="post-new-listing"
        title={t('employer.postListing')}
        onPress={() => router.push('/employer/listings/new')}
      />
      {items.length === 0 ? (
        <EmptyState message={t('employer.noListings')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}
          renderItem={({ item }) => (
            <Card
              testID={`listing-${item.id}`}
              onPress={() => router.push(`/employer/listings/${item.id}`)}
            >
              <View style={{ gap: spacing.xs }}>
                <Text variant="heading">{item.title}</Text>
                <Text color="textMuted">
                  {t(`categories.${item.categorySlug}`)} · {item.city}
                </Text>
                <Text color="textMuted">
                  {formatRupees(item.payAmountPaise)} / {t(`employer.payTypes.${item.payType}`)} ·{' '}
                  {t('employer.filledOf', { filled: item.filledCount, openings: item.openings })}
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text color={STATUS_COLOR[item.status] ?? 'text'}>
                    {t(`employer.listingStatus.${item.status}`)}
                  </Text>
                  <Text color="textMuted" testID={`listing-${item.id}-applicants`}>
                    {t('employer.applicantCount', { count: item.applicationCount ?? 0 })}
                  </Text>
                </View>
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
