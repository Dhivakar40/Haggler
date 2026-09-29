import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';
import { cancelRequest, rebroadcastRequest, requestKey, useRequest } from '../../api/market';
import { Button, Card, Countdown, ErrorState, LoadingState, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { isTimedOut, isWaitingForRanger } from '../../lib/job-status';
import { useNow } from '../../lib/useNow';
import { spacing } from '../../theme/tokens';

const WAVE_KM = [2, 5, 10];

/**
 * The customer waits here after requesting (D3): live countdown, "usually accepted in ~N min",
 * and, if nobody accepts in time, the choice to ask again or cancel. As soon as a Ranger accepts
 * the screen moves on to the job.
 */
export function RequestStatusScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: job, isLoading, isError, refetch } = useRequest(id);
  const now = useNow(1000);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // A Ranger accepted (or the job moved past broadcasting): hand over to the job screen.
  useEffect(() => {
    if (job && !isWaitingForRanger(job) && job.status !== 'CANCELLED')
      router.replace({ pathname: '/job/[id]', params: { id: job.id } });
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

  const timedOut = isTimedOut(job, now);
  const scheduledWait = job.status === 'REQUESTED' && job.scheduledFor;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: requestKey(id as string) });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const confirmCancel = () =>
    Alert.alert(t('requestStatus.cancel'), undefined, [
      { text: t('job.keep'), style: 'cancel' },
      {
        text: t('requestStatus.cancel'),
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await cancelRequest(id as string);
            router.replace('/');
          }),
      },
    ]);

  if (job.status === 'CANCELLED') {
    return (
      <Screen>
        <Text variant="title">{t('requestStatus.cancelled')}</Text>
        <Button title={t('requestStatus.back')} onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const gender =
    job.genderPreference === 'ANY'
      ? null
      : t(job.genderPreference === 'FEMALE' ? 'request.female' : 'request.male').toLowerCase();

  return (
    <Screen scroll>
      <Text variant="title">{t(`categories.${job.categorySlug}`)}</Text>
      <Text color="textMuted">{job.description}</Text>

      <Card testID="status-card">
        <View style={{ gap: spacing.sm }}>
          {scheduledWait ? (
            <Text testID="scheduled">
              {t('requestStatus.scheduled', {
                when: new Date(job.scheduledFor as string).toLocaleString(),
              })}
            </Text>
          ) : timedOut ? (
            <>
              <Text variant="heading" testID="timed-out">
                {t('requestStatus.timedOut')}
              </Text>
              <Text color="textMuted">{t('requestStatus.timedOutHelp')}</Text>
            </>
          ) : (
            <>
              <Text variant="heading" testID="finding">
                {t('requestStatus.finding')}
              </Text>
              <Text color="textMuted">
                {t('requestStatus.wave', {
                  km: WAVE_KM[Math.max(0, (job.broadcast?.wave ?? 1) - 1)] ?? 10,
                })}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Text color="textMuted">{t('requestStatus.timeLeft', { time: '' })}</Text>
                <Countdown
                  testID="countdown"
                  until={job.broadcast?.deadline ?? null}
                  variant="label"
                />
              </View>
              {job.broadcast ? (
                <Text testID="sla" color="textMuted">
                  {t('requestStatus.sla', { minutes: job.broadcast.slaEstimateMinutes })}
                </Text>
              ) : null}
            </>
          )}
          {gender && job.genderPreferenceMet === false ? (
            <Text testID="gender-unmet" color="warning">
              {t('requestStatus.genderUnmet', { gender })}
            </Text>
          ) : null}
        </View>
      </Card>

      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {timedOut ? (
        <Button
          testID="rebroadcast"
          title={t('requestStatus.rebroadcast')}
          onPress={() => void run(() => rebroadcastRequest(id as string))}
          loading={busy}
        />
      ) : null}
      <Button
        testID="cancel-request"
        variant={timedOut ? 'secondary' : 'danger'}
        title={t('requestStatus.cancel')}
        onPress={confirmCancel}
        disabled={busy}
      />
    </Screen>
  );
}
