import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useWorkerReviews } from '../../api/reputation';
import { Card, EmptyState, ErrorState, LoadingState, Rating, Screen, Text } from '../../components';
import { spacing } from '../../theme/tokens';

/** A Ranger's public review history: only what customers said, newest first. */
export function RangerReviewsScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useWorkerReviews(id);

  if (isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (isError || !data)
    return (
      <Screen>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Screen>
    );

  return (
    <Screen scroll>
      <Text variant="title">{t('job.reviewsTitle')}</Text>
      {data.items.length === 0 ? <EmptyState message={t('job.noReviewsYet')} /> : null}
      {data.items.map((r) => (
        <Card key={r.id} testID={`review-${r.id}`}>
          <View style={{ gap: spacing.xs }}>
            <Rating value={r.rating} size={16} />
            <Text variant="label" color="textMuted">
              {r.customerFirstName ?? t('job.customer')}
            </Text>
            {r.comment ? <Text>{r.comment}</Text> : null}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
