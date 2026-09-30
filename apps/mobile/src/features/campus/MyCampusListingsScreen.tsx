import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { useMyCampusListings } from '../../api/campus';
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

export function MyCampusListingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const listings = useMyCampusListings();

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
        testID="post-new-campus-listing"
        title={t('employer.postListing')}
        onPress={() => router.push('/employer/campus/new')}
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
              testID={`campus-listing-${item.id}`}
              onPress={() => router.push(`/employer/campus/${item.id}`)}
            >
              <View style={{ gap: spacing.xs }}>
                <Text variant="heading">{item.title}</Text>
                <Text color="textMuted">
                  {t(`categories.${item.categorySlug}`)} · {item.city}
                </Text>
                <Text color="textMuted">
                  {formatRupees(item.hourlyRatePaise)}/{t('campus.perHour')} ·{' '}
                  {t('campus.hoursPerWeekShort', { hours: item.hoursPerWeek })}
                  {item.isNightShift ? ` · ${t('campus.nightShift')}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text color={STATUS_COLOR[item.status] ?? 'text'}>
                    {t(`employer.listingStatus.${item.status}`)}
                  </Text>
                  <Text color="textMuted" testID={`campus-listing-${item.id}-applicants`}>
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
