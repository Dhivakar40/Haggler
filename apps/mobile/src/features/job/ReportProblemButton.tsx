import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { JobDto } from '@haggler/shared';
import { raiseDispute } from '../../api/market';
import { Button, Sheet, Text, TextField } from '../../components';
import { spacing } from '../../theme/tokens';
import type { useJobAction } from './useJobAction';

type Action = ReturnType<typeof useJobAction>;

/** D-080 (Sub-phase D/F): "report a problem" on a job the customer already confirmed — the
 * mobile face of raiseDispute(). Only shown once confirmed, and only while no dispute on this
 * job is already open; the API enforces both rules too, this just avoids a pointless round trip. */
export function ReportProblemButton({ job, action }: { job: JobDto; action: Action }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();

  if (job.status !== 'CONFIRMED_BY_CUSTOMER') return null;
  if (job.disputes.some((d) => d.status === 'OPEN')) return null;

  function submit() {
    if (reason.trim().length < 10) return setError(t('job.reportProblemTooShort'));
    setError(undefined);
    void action.run('dispute', () => raiseDispute(job.id, reason.trim())).then((ok) => {
      if (ok) {
        setOpen(false);
        setReason('');
      }
    });
  }

  return (
    <>
      <Button
        testID="report-problem"
        variant="secondary"
        title={t('job.reportProblem')}
        onPress={() => setOpen(true)}
      />
      <Sheet testID="report-problem-sheet" visible={open} onClose={() => setOpen(false)}>
        <View style={{ gap: spacing.sm }}>
          <Text variant="heading">{t('job.reportProblemTitle')}</Text>
          <Text color="textMuted">{t('job.reportProblemExplain')}</Text>
          <TextField
            testID="report-problem-reason"
            label={t('job.reportProblemLabel')}
            value={reason}
            onChangeText={setReason}
            multiline
          />
          {error ? (
            <Text color="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button
            testID="report-problem-submit"
            title={t('job.reportProblemSubmit')}
            loading={action.busy === 'dispute'}
            onPress={submit}
          />
        </View>
      </Sheet>
    </>
  );
}
