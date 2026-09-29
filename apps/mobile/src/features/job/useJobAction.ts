import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { JobDto } from '@haggler/shared';
import { jobKey } from '../../api/market';
import { errorMessage } from '../../lib/errors';

/**
 * Runs one job action at a time: shows a busy flag, puts the server's fresh answer straight into the
 * cache (so the screen updates instantly), and turns any failure into a message in the user's language.
 */
export function useJobAction(jobId: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(
    async (name: string, fn: () => Promise<JobDto | unknown>): Promise<boolean> => {
      setBusy(name);
      setError(undefined);
      try {
        const res = await fn();
        if (res && typeof res === 'object' && 'status' in res && 'viewerRole' in res)
          qc.setQueryData(jobKey(jobId), res);
        else await qc.invalidateQueries({ queryKey: jobKey(jobId) });
        void qc.invalidateQueries({ queryKey: ['jobs'] });
        return true;
      } catch (err) {
        setError(errorMessage(err, t));
        // A stale-state conflict means someone else moved the job: re-read it.
        void qc.invalidateQueries({ queryKey: jobKey(jobId) });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [jobId, qc, t],
  );

  return { busy, error, run, clearError: () => setError(undefined) };
}
