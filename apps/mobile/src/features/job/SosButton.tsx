import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ACTIVE_JOB_STATES, type JobDto } from '@haggler/shared';
import { triggerSos } from '../../api/market';
import { Button, Dialog } from '../../components';
import type { useJobAction } from './useJobAction';

type Action = ReturnType<typeof useJobAction>;

/** D-080 (Sub-phase C): either party can raise this while the job is active. The other party is
 * pushed at once (SosService); reaching the triggering party's own emergency contacts is a
 * separate, client-side share (same as the existing live-trip share link), not built here. */
export function SosButton({ job, action }: { job: JobDto; action: Action }) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  if (!(ACTIVE_JOB_STATES as readonly string[]).includes(job.status)) return null;

  return (
    <>
      <Button
        testID="sos-button"
        variant="danger"
        title={t('job.sos')}
        onPress={() => setDialogOpen(true)}
      />
      <Dialog
        testID="sos-dialog"
        visible={dialogOpen}
        title={t('job.sosAsk')}
        message={t('job.sosExplain')}
        confirmLabel={t('job.sosConfirm')}
        onConfirm={() => {
          setDialogOpen(false);
          void action.run('sos', () => triggerSos(job.id));
        }}
        cancelLabel={t('job.keep')}
        onCancel={() => setDialogOpen(false)}
        destructive
      />
    </>
  );
}
