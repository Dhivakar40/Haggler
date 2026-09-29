import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { useJob } from '../../api/market';
import { Button, Card, ErrorState, LoadingState, Screen, Text } from '../../components';
import { mapsUrl } from '../../components/TrackingMap';
import { isWaitingForRanger, statusKeys } from '../../lib/job-status';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';
import { CustomerActions } from './CustomerActions';
import { NegotiationPanel } from './NegotiationPanel';
import { RangerActions } from './RangerActions';
import { useJobAction } from './useJobAction';

/** One screen for both people. What each sees and can do is decided by the server-built view and the job state. */
export function JobScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: job, isLoading, isError, refetch } = useJob(id);
  const action = useJobAction(id as string);

  // Still looking for a Ranger: that is the request screen's job.
  useEffect(() => {
    if (job && job.viewerRole === 'CUSTOMER' && isWaitingForRanger(job))
      router.replace({ pathname: '/request/[id]', params: { id: job.requestId } });
  }, [job, router]);

  if (isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (isError || !job)
    return (
      <Screen>
        <ErrorState onRetry={() => void refetch()} />
      </Screen>
    );

  const isRanger = job.viewerRole === 'WORKER';
  const other = isRanger ? job.customer : job.worker;
  const negotiating = job.status === 'MATCHED' || job.status === 'NEGOTIATING';
  const showChat = !!job.threadId && !['CANCELLED'].includes(job.status);

  return (
    <Screen scroll>
      <Text variant="title" testID="status-title">
        {t(statusKeys(job))}
      </Text>
      <Text color="textMuted">
        {t(`categories.${job.categorySlug}`)} · {job.description}
      </Text>

      {job.agreedPricePaise ? (
        <Card>
          <Text testID="agreed-price" variant="heading">
            {t('job.agreedPrice')}: {formatRupees(job.agreedPricePaise)}
          </Text>
        </Card>
      ) : null}

      {other ? (
        <Card testID="party">
          <View style={{ gap: spacing.xs }}>
            <Text variant="label" color="textMuted">
              {isRanger ? t('job.customer') : t('job.ranger')}
            </Text>
            <Text variant="heading">{other.firstName ?? '—'}</Text>
            {!isRanger && job.worker ? (
              <Text color="textMuted" testID="ranger-meta">
                {t('job.level', { tier: job.worker.kycTier })} · {job.worker.badgeTier} ·{' '}
                {t('job.jobsDone', { count: job.worker.jobsCompleted })}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      {job.addressLine ? (
        <Card testID="address">
          <View style={{ gap: spacing.sm }}>
            <Text variant="label" color="textMuted">
              {t('job.address')}
            </Text>
            <Text>{job.addressLine}</Text>
            {isRanger && job.location ? (
              <Button
                testID="navigate"
                variant="secondary"
                title={t('job.navigate')}
                onPress={() => void Linking.openURL(mapsUrl(job.location!))}
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      {negotiating ? <NegotiationPanel job={job} action={action} /> : null}

      {isRanger ? (
        <RangerActions job={job} action={action} />
      ) : (
        <CustomerActions job={job} action={action} />
      )}

      {job.cancellation?.feeApplies && !isRanger ? (
        <Text testID="fee-note" color="warning">
          {t('job.feeNote')}
        </Text>
      ) : null}

      {action.error ? (
        <Text color="danger" accessibilityRole="alert" testID="action-error">
          {action.error}
        </Text>
      ) : null}

      {showChat ? (
        <Button
          testID="open-chat"
          variant="secondary"
          title={t('job.chat')}
          onPress={() => router.push({ pathname: '/chat/[jobId]', params: { jobId: job.id } })}
        />
      ) : null}
    </Screen>
  );
}
