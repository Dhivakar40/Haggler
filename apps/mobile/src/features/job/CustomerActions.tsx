import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Share, View } from 'react-native';
import { type JobDto, SOCKET_EVENTS, type TrackDto } from '@haggler/shared';
import { cancelJob, confirmJob, createShareLink, getTrack, reportNoShow } from '../../api/market';
import { Button, Card, Text, TrackingMap } from '../../components';
import { errorMessage } from '../../lib/errors';
import { checkLeagueUp } from '../../lib/league-up-check';
import { formatRupees } from '../../lib/money';
import { useRealtimeEvent } from '../../realtime/RealtimeProvider';
import { spacing } from '../../theme/tokens';
import type { useJobAction } from './useJobAction';

type Action = ReturnType<typeof useJobAction>;
const TRACKED = ['AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

/** Everything the customer can do: watch the Ranger, read out the arrival code, confirm, share, cancel. */
export function CustomerActions({ job, action }: { job: JobDto; action: Action }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [shareError, setShareError] = useState<string>();
  const s = job.status;
  const tracked = TRACKED.includes(s);

  const track = useQuery({
    queryKey: ['track', job.id],
    queryFn: () => getTrack(job.id),
    enabled: tracked,
    refetchInterval: 10_000,
  });

  // A live point from the Ranger: drop it straight into the cache so the map moves without a refetch.
  useRealtimeEvent<{
    jobId: string;
    latitude: number;
    longitude: number;
    accuracyM: number | null;
    recordedAt: string;
  }>(SOCKET_EVENTS.location, (e) => {
    if (e.jobId !== job.id) return;
    qc.setQueryData<TrackDto>(['track', job.id], (old) =>
      old
        ? {
            ...old,
            worker: {
              latitude: e.latitude,
              longitude: e.longitude,
              accuracyM: e.accuracyM,
              recordedAt: e.recordedAt,
            },
          }
        : old,
    );
  });
  useEffect(() => {
    setShareError(undefined);
  }, [s]);

  async function share() {
    setShareError(undefined);
    try {
      const link = await createShareLink(job.id);
      await Share.share({ message: t('job.shareMessage', { url: link.url }) });
    } catch (err) {
      setShareError(errorMessage(err, t));
    }
  }

  const confirmCancel = () =>
    Alert.alert(t('job.cancelAsk'), undefined, [
      { text: t('job.keep'), style: 'cancel' },
      {
        text: t('job.cancel'),
        style: 'destructive',
        onPress: () => void action.run('cancel', () => cancelJob(job.id)),
      },
    ]);

  const cancellable = ['MATCHED', 'NEGOTIATING', 'AGREED', 'EN_ROUTE', 'ARRIVED'].includes(s);
  const shareable = [
    'MATCHED',
    'NEGOTIATING',
    'AGREED',
    'EN_ROUTE',
    'ARRIVED',
    'IN_PROGRESS',
  ].includes(s);

  return (
    <View style={{ gap: spacing.md }}>
      {tracked ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="heading">{t('job.trackingTitle')}</Text>
          <TrackingMap
            destination={job.location}
            worker={track.data?.worker ?? null}
            trail={track.data?.trail}
          />
        </View>
      ) : null}

      {s === 'ARRIVED' && job.arrivalCode ? (
        <Card testID="arrival-code-card">
          <View style={{ gap: spacing.sm, alignItems: 'center' }}>
            <Text variant="heading">{t('job.codeTitle')}</Text>
            <Text
              testID="arrival-code-value"
              variant="title"
              style={{ fontSize: 48, lineHeight: 56, letterSpacing: 8 }}
              accessibilityLabel={job.arrivalCode.split('').join(' ')}
            >
              {job.arrivalCode}
            </Text>
            <Text color="textMuted" style={{ textAlign: 'center' }}>
              {t('job.codeHelp')}
            </Text>
          </View>
        </Card>
      ) : null}

      {s === 'COMPLETED_BY_WORKER' ? (
        <Card testID="confirm-card">
          <View style={{ gap: spacing.sm }}>
            {job.agreedPricePaise && job.paymentMethod ? (
              <Text testID="pay-note" variant="heading">
                {t('job.payNote', {
                  amount: formatRupees(job.agreedPricePaise),
                  method: job.paymentMethod === 'CASH' ? t('job.cash') : t('job.upi'),
                })}
              </Text>
            ) : null}
            <Button
              testID="confirm-done"
              title={t('job.confirmDone')}
              loading={action.busy === 'confirm'}
              onPress={() =>
                void action.run('confirm', () => confirmJob(job.id)).then((ok) => {
                  // D-078/D-079: the league recompute runs deferred, not inside confirm() itself —
                  // one refetch ~2s later, not a polling loop, is enough to catch a promotion the
                  // moment it's actually landed (Sub-phase 4, Part F).
                  if (ok) setTimeout(() => void checkLeagueUp(), 2000);
                })
              }
            />
          </View>
        </Card>
      ) : null}

      {['MATCHED', 'NEGOTIATING'].includes(s) ? null : s === 'AGREED' ? (
        <Text testID="wait-ranger" color="textMuted">
          {t('job.waitRanger')}
        </Text>
      ) : null}

      {s === 'EN_ROUTE' ? (
        <Button
          testID="no-show"
          variant="secondary"
          title={t('job.noShow')}
          loading={action.busy === 'noshow'}
          onPress={() => void action.run('noshow', () => reportNoShow(job.id))}
        />
      ) : null}
      {shareable ? (
        <Button
          testID="share-link"
          variant="secondary"
          title={t('job.shareLive')}
          onPress={() => void share()}
        />
      ) : null}
      {shareError ? (
        <Text color="danger" accessibilityRole="alert">
          {shareError}
        </Text>
      ) : null}
      {cancellable ? (
        <Button
          testID="cancel-job"
          variant="danger"
          title={t('job.cancel')}
          onPress={confirmCancel}
        />
      ) : null}
    </View>
  );
}
