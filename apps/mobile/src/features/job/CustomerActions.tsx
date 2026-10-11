import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';
import { type JobDto, SOCKET_EVENTS, type TrackDto } from '@haggler/shared';
import {
  cancelJob,
  confirmJob,
  createShareLink,
  getTrack,
  reportNoShow,
  startOnlinePayment,
} from '../../api/market';
import { sandboxPay } from '../../api/wallet';
import { Button, Card, Dialog, Text, TextField, TrackingMap } from '../../components';
import { errorMessage } from '../../lib/errors';
import { checkLeagueUp } from '../../lib/league-up-check';
import { formatRupees, jobTotalPaise, parseRupeesToPaise } from '../../lib/money';
import { useRealtimeEvent } from '../../realtime/RealtimeProvider';
import { spacing } from '../../theme/tokens';
import { ReportProblemButton } from './ReportProblemButton';
import { SosButton } from './SosButton';
import type { useJobAction } from './useJobAction';

type Action = ReturnType<typeof useJobAction>;
const TRACKED = ['AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

/** Everything the customer can do: watch the Ranger, read out the arrival code, confirm, share, cancel. */
export function CustomerActions({ job, action }: { job: JobDto; action: Action }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [shareError, setShareError] = useState<string>();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const totalPaise = jobTotalPaise(job);
  const [cashInput, setCashInput] = useState(() => String(totalPaise / 100));
  const [payError, setPayError] = useState<string>();
  const s = job.status;
  const tracked = TRACKED.includes(s);

  function afterConfirm(ok: unknown) {
    // D-078/D-079: the league recompute runs deferred, not inside confirm() itself — one refetch
    // ~2s later, not a polling loop, is enough to catch a promotion the moment it's landed.
    if (ok) setTimeout(() => void checkLeagueUp(), 2000);
  }

  function confirmCash() {
    const paise = parseRupeesToPaise(cashInput);
    if (paise === null || paise < 0) return setPayError(t('job.cashCollectedInvalid'));
    setPayError(undefined);
    void action.run('confirm', () => confirmJob(job.id, paise)).then(afterConfirm);
  }

  function payAndConfirm() {
    setPayError(undefined);
    void action
      .run('confirm', async () => {
        const order = await startOnlinePayment(job.id);
        await sandboxPay(order.orderId);
        return confirmJob(job.id);
      })
      .then(afterConfirm);
  }

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
              variant="display"
              style={{ letterSpacing: 8 }}
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
                  amount: formatRupees(totalPaise),
                  method: job.paymentMethod === 'CASH' ? t('job.cash') : t('job.upi'),
                })}
              </Text>
            ) : null}
            {job.paymentMethod === 'CASH' ? (
              <View style={{ gap: spacing.xs }}>
                <TextField
                  testID="cash-confirmed"
                  label={t('job.cashConfirmedLabel')}
                  value={cashInput}
                  onChangeText={setCashInput}
                  keyboardType="decimal-pad"
                />
                {job.payment?.cashRecordedPaise !== null &&
                job.payment?.cashRecordedPaise !== undefined ? (
                  <Text color="textMuted">
                    {t('job.cashConfirmedHelp', {
                      amount: formatRupees(job.payment.cashRecordedPaise),
                    })}
                  </Text>
                ) : null}
                <Button
                  testID="confirm-done"
                  title={t('job.confirmDone')}
                  loading={action.busy === 'confirm'}
                  onPress={confirmCash}
                />
              </View>
            ) : (
              <View style={{ gap: spacing.xs }}>
                <Text color="textMuted">
                  {t('job.payOnlineHelp', { amount: formatRupees(totalPaise) })}
                </Text>
                <Text color="textMuted">{t('job.payOnlineDiscount')}</Text>
                <Button
                  testID="pay-and-confirm"
                  title={t('job.payAndConfirm')}
                  loading={action.busy === 'confirm'}
                  onPress={payAndConfirm}
                />
              </View>
            )}
            {payError ? (
              <Text color="danger" accessibilityRole="alert">
                {payError}
              </Text>
            ) : null}
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
          onPress={() => setCancelDialogOpen(true)}
        />
      ) : null}
      <SosButton job={job} action={action} />
      <ReportProblemButton job={job} action={action} />

      <Dialog
        testID="cancel-dialog"
        visible={cancelDialogOpen}
        title={t('job.cancelAsk')}
        confirmLabel={t('job.cancel')}
        onConfirm={() => {
          setCancelDialogOpen(false);
          void action.run('cancel', () => cancelJob(job.id));
        }}
        cancelLabel={t('job.keep')}
        onCancel={() => setCancelDialogOpen(false)}
        destructive
      />
    </View>
  );
}
