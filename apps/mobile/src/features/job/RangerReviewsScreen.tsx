import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useWorkerReviews } from '../../api/reputation';
import { Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

function Stars({ n }: { n: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons
          key={i}
          name={i <= n ? 'star' : 'star-outline'}
          size={16}
          color={colors.warning}
        />
      ))}
    </View>
  );
}

/** A Ranger's public review history: only what customers said, newest first. */
export function RangerReviewsScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useWorkerReviews(id);

  if (isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (isError || !data)
    return (
      <Screen>
        <ErrorState onRetry={() => void refetch()} />
      </Screen>
    );

  return (
    <Screen scroll>
      <Text variant="title">{t('job.reviewsTitle')}</Text>
      {data.items.length === 0 ? <EmptyState message={t('job.noReviewsYet')} /> : null}
      {data.items.map((r) => (
        <Card key={r.id} testID={`review-${r.id}`}>
          <View style={{ gap: spacing.xs }}>
            <Stars n={r.rating} />
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
