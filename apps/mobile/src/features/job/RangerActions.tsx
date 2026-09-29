import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';
import type { JobDto } from '@haggler/shared';
import { ApiError } from '../../api/client';
import {
  arrive,
  cancelJob,
  completeJob,
  enRoute,
  reportNoShow,
  startJob,
  verifyArrival,
} from '../../api/market';
import { Button, Card, Chip, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { spacing } from '../../theme/tokens';
import { uploadJobPhoto } from '../media/upload';
import type { useJobAction } from './useJobAction';

type Action = ReturnType<typeof useJobAction>;

/** Everything the Ranger can do on a matched job, one step at a time, in the order the rules require. */
export function RangerActions({ job, action }: { job: JobDto; action: Action }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [payment, setPayment] = useState<'CASH' | 'UPI'>('CASH');
  const [photoError, setPhotoError] = useState<string>();
  const [photoBusy, setPhotoBusy] = useState<'BEFORE' | 'AFTER' | null>(null);
  const s = job.status;

  /** The job photo must be taken with the camera at the site, never picked from the gallery. */
  async function takePhoto(kind: 'BEFORE' | 'AFTER') {
    setPhotoError(undefined);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setPhotoError(t('kyc.permissionDenied'));
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = res.canceled ? undefined : res.assets?.[0];
    if (!asset) return;
    setPhotoBusy(kind);
    try {
      await uploadJobPhoto(job.id, kind, asset.uri, asset.width);
      await action.run('refresh', async () => undefined);
    } catch (err) {
      setPhotoError(err instanceof ApiError ? errorMessage(err, t) : t('kyc.uploadFailed'));
    } finally {
      setPhotoBusy(null);
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

  return (
    <View style={{ gap: spacing.md }}>
      {s === 'AGREED' ? (
        <Button
          testID="en-route"
          title={t('job.enRoute')}
          loading={action.busy === 'enroute'}
          onPress={() => void action.run('enroute', () => enRoute(job.id))}
        />
      ) : null}

      {s === 'EN_ROUTE' ? (
        <Button
          testID="arrive"
          title={t('job.arrived')}
          loading={action.busy === 'arrive'}
          onPress={() => void action.run('arrive', () => arrive(job.id))}
        />
      ) : null}

      {s === 'ARRIVED' && !job.arrivalVerified ? (
        <Card testID="code-entry">
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading">{t('job.enterCode')}</Text>
            <TextField
              testID="arrival-code"
              label={t('job.codeLabel')}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
            />
            <Button
              testID="verify-code"
              title={t('job.verify')}
              disabled={code.length !== 4}
              loading={action.busy === 'verify'}
              onPress={() =>
                void action
                  .run('verify', () => verifyArrival(job.id, code))
                  .then((ok) => ok && setCode(''))
              }
            />
          </View>
        </Card>
      ) : null}

      {s === 'ARRIVED' && job.arrivalVerified ? (
        <Card testID="before-start">
          <View style={{ gap: spacing.sm }}>
            <Button
              testID="before-photo"
              variant={job.hasBeforePhoto ? 'secondary' : 'primary'}
              title={t('job.beforePhoto')}
              loading={photoBusy === 'BEFORE'}
              onPress={() => void takePhoto('BEFORE')}
            />
            {job.hasBeforePhoto ? (
              <Text testID="before-done" color="success">
                {t('job.photoAdded')}
              </Text>
            ) : null}
            <Button
              testID="start-work"
              title={t('job.start')}
              disabled={!job.hasBeforePhoto}
              loading={action.busy === 'start'}
              onPress={() => void action.run('start', () => startJob(job.id))}
            />
          </View>
        </Card>
      ) : null}

      {s === 'IN_PROGRESS' ? (
        <Card testID="finish">
          <View style={{ gap: spacing.sm }}>
            <Button
              testID="after-photo"
              variant={job.hasAfterPhoto ? 'secondary' : 'primary'}
              title={t('job.afterPhoto')}
              loading={photoBusy === 'AFTER'}
              onPress={() => void takePhoto('AFTER')}
            />
            {job.hasAfterPhoto ? (
              <Text testID="after-done" color="success">
                {t('job.photoAdded')}
              </Text>
            ) : null}
            <Text variant="label">{t('job.howPay')}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Chip
                testID="pay-CASH"
                label={t('job.cash')}
                selected={payment === 'CASH'}
                onPress={() => setPayment('CASH')}
              />
              <Chip
                testID="pay-UPI"
                label={t('job.upi')}
                selected={payment === 'UPI'}
                onPress={() => setPayment('UPI')}
              />
            </View>
            <Button
              testID="finish-job"
              title={t('job.finish')}
              disabled={!job.hasAfterPhoto}
              loading={action.busy === 'complete'}
              onPress={() => void action.run('complete', () => completeJob(job.id, payment))}
            />
          </View>
        </Card>
      ) : null}

      {s === 'COMPLETED_BY_WORKER' ? (
        <Text testID="wait-confirm" color="textMuted">
          {t('job.waitCustomer')}
        </Text>
      ) : null}

      {photoError ? (
        <Text color="danger" accessibilityRole="alert">
          {photoError}
        </Text>
      ) : null}

      {s === 'ARRIVED' ? (
        <Button
          testID="no-show"
          variant="secondary"
          title={t('job.noShow')}
          loading={action.busy === 'noshow'}
          onPress={() => void action.run('noshow', () => reportNoShow(job.id))}
        />
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
