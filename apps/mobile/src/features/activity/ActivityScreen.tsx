import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useJobs } from '../../api/market';
import { useSession } from '../../auth/session';
import { Card, Chip, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

/** My requests as a customer, and (for Rangers) my jobs. Tapping one opens it. */
export function ActivityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const isRanger = useSession((s) => s.user?.roles.includes('WORKER') ?? false);
  const [role, setRole] = useState<'CUSTOMER' | 'WORKER'>('CUSTOMER');
  const { data, isLoading, isError, refetch } = useJobs(role);

  return (
    <Screen scroll>
      <Text variant="title">{t('activity.title')}</Text>
      {isRanger ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Chip
            testID="role-customer"
            label={t('activity.asCustomer')}
            selected={role === 'CUSTOMER'}
            onPress={() => setRole('CUSTOMER')}
          />
          <Chip
            testID="role-ranger"
            label={t('activity.asRanger')}
            selected={role === 'WORKER'}
            onPress={() => setRole('WORKER')}
          />
        </View>
      ) : null}
      {isLoading && <LoadingState />}
      {isError && <ErrorState onRetry={() => void refetch()} />}
      {data?.items.length === 0 && <EmptyState message={t('activity.empty')} />}
      {data?.items.map((j) => (
        <Card
          key={j.id}
          testID={`job-${j.id}`}
          accessibilityLabel={t(`categories.${j.categorySlug}`)}
          onPress={() => router.push({ pathname: '/job/[id]', params: { id: j.id } })}
        >
          <View style={{ gap: spacing.xs }}>
            <Text variant="heading">{t(`categories.${j.categorySlug}`)}</Text>
            <Text color="textMuted">{j.description}</Text>
            <Text variant="label">
              {t(`job.status.${j.status}`)}
              {j.agreedPricePaise ? ` · ${formatRupees(j.agreedPricePaise)}` : ''}
            </Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
