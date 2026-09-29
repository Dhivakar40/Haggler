import { useCallback } from 'react';
import { sendLocation, useJobs, usePresence } from '../../api/market';
import { useSession } from '../../auth/session';
import { isActive } from '../../lib/job-status';
import { type TrackMode, useLocationTracker } from '../../location/tracker';
import { useRealtime } from '../../realtime/RealtimeProvider';

/**
 * The ONE place that streams the Ranger's location (rendering it twice would double-send).
 *   online, no job -> a relaxed heartbeat so matching knows they are reachable;
 *   active job     -> the fast, battery-aware cadence, plus the background task.
 * Each fix goes over the live socket when connected, and falls back to REST when it is not.
 */
export function TrackerHost() {
  const isRanger = useSession((s) => s.user?.roles.includes('WORKER') ?? false);
  const realtime = useRealtime();
  const presence = usePresence(isRanger);
  const jobs = useJobs('WORKER', isRanger);
  const active = jobs.data?.items.find((j) => isActive(j.status));
  const mode: TrackMode = !isRanger
    ? 'off'
    : active
      ? 'job'
      : presence.data?.isOnline
        ? 'online'
        : 'off';

  const send = useCallback(
    async (p: { latitude: number; longitude: number; accuracyM?: number }) => {
      if (realtime?.isConnected()) {
        try {
          const ack = await realtime.emitWithAck<{ ok: boolean }>('location.update', p);
          if (ack?.ok) return;
        } catch {
          /* fall through to REST */
        }
      }
      await sendLocation(p.latitude, p.longitude, p.accuracyM);
    },
    [realtime],
  );

  useLocationTracker(mode, active?.status, send);
  return null;
}
