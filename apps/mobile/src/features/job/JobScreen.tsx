import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { LeagueTier } from '@haggler/shared';
import { useJob } from '../../api/market';
import { blockUser } from '../../api/reputation';
import {
  Avatar,
  Button,
  Card,
  Dialog,
  ErrorState,
  LeagueBadge,
  LoadingState,
  Screen,
  Text,
} from '../../components';
import { mapsUrl } from '../../components/TrackingMap';
import { errorMessage } from '../../lib/errors';
import { isWaitingForRanger, statusKeys } from '../../lib/job-status';
import { formatRupees } from '../../lib/money';
import { MIN_TOUCH_TARGET, spacing } from '../../theme/tokens';
import { CustomerActions } from './CustomerActions';
import { JobTimeline } from './JobTimeline';
import { QuotesPanel } from './QuotesPanel';
import { RangerActions } from './RangerActions';
import { ReviewPrompt } from './ReviewPrompt';
import { useJobAction } from './useJobAction';

/** One screen for both people. What each sees and can do is decided by the server-built view and the job state. */
export function JobScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: job, isLoading, isError, refetch } = useJob(id);
  const action = useJobAction(id as string);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);

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
  const showChat = !!job.threadId && !['CANCELLED'].includes(job.status);

  async function block() {
    if (!other) return;
    setBlockBusy(true);
    setBlockError(undefined);
    try {
      await blockUser({ userId: other.id });
      setBlocked(true);
    } catch (err) {
      setBlockError(errorMessage(err, t));
    } finally {
      setBlockBusy(false);
    }
  }

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
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar name={other.firstName} />
              <View style={{ gap: spacing.xs }}>
                <Text variant="label" color="textMuted">
                  {isRanger ? t('job.customer') : t('job.ranger')}
                </Text>
                <Text variant="heading">{other.firstName ?? '—'}</Text>
              </View>
            </View>
            {!isRanger && job.worker ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text color="textMuted" testID="ranger-meta">
                    {t('job.level', { tier: job.worker.kycTier })} ·{' '}
                    {t('job.jobsDone', { count: job.worker.jobsCompleted })}
                  </Text>
                  <LeagueBadge tier={job.worker.league as LeagueTier} kind="worker" size="sm" />
                </View>
                <Text
                  testID="ranger-rating"
                  color="textMuted"
                  accessibilityRole="link"
                  onPress={() =>
                    router.push({
                      pathname: '/ranger-reviews/[id]',
                      params: { id: job.worker!.id },
                    })
                  }
                >
                  {job.worker.ratingAvg !== null
                    ? t('job.ratingWithCount', {
                        rating: job.worker.ratingAvg.toFixed(1),
                        count: job.worker.ratingCount,
                      })
                    : t('job.noRatingsYet')}
                </Text>
              </>
            ) : null}
            {!blocked ? (
              <Pressable
                testID="block-user"
                accessibilityRole="button"
                accessibilityLabel={isRanger ? t('job.blockCustomer') : t('job.blockRanger')}
                onPress={() => setBlockDialogOpen(true)}
                disabled={blockBusy}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.blockLink,
                  (pressed || blockBusy) && { opacity: 0.5 },
                ]}
              >
                <Text color="danger">{isRanger ? t('job.blockCustomer') : t('job.blockRanger')}</Text>
              </Pressable>
            ) : (
              <Text testID="blocked-note" color="textMuted">
                {t('job.blocked')}
              </Text>
            )}
            {blockError ? (
              <Text color="danger" accessibilityRole="alert">
                {blockError}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      <Dialog
        testID="block-dialog"
        visible={blockDialogOpen}
        title={isRanger ? t('job.blockCustomerAsk') : t('job.blockRangerAsk')}
        message={t('job.blockExplain')}
        confirmLabel={t('job.block')}
        onConfirm={() => {
          setBlockDialogOpen(false);
          void block();
        }}
        cancelLabel={t('common.cancel')}
        onCancel={() => setBlockDialogOpen(false)}
        destructive
      />

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

      {job.listedPricePaise === null && job.status === 'BROADCASTING' ? (
        <QuotesPanel job={job} action={action} />
      ) : null}

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

      <ReviewPrompt job={job} />

      <JobTimeline job={job} />

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

const styles = StyleSheet.create({
  blockLink: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
});
