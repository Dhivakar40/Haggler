import { CLIENT_LEAGUE_TIERS, LEAGUE_TIERS } from '@haggler/shared';
import { getClientLeagueStatus, getLeagueStatus } from '../api/endpoints';
import { useSession } from '../auth/session';
import { useLeagueSeen } from '../store/league-seen';
import { useLeagueUpQueue } from '../store/league-up-queue';

/**
 * Sub-phase 4, Part F: detects "my league just went up" by comparing a freshly-fetched league
 * against the last one stored locally for this user id, entirely client-side — confirm()'s league
 * recompute runs deferred (D-078/D-079) and there is no new backend signal for this by design (no
 * Job column, no queue). Call on login, on app foreground, and ~2s after a customer's confirm().
 *
 * The first fetch ever for a user sets the baseline silently (no popup) — otherwise every fresh
 * install or post-logout sign-in would "celebrate" a league the person already had. If multiple
 * leagues were skipped between checks, only the highest one reached is queued.
 */
export async function checkLeagueUp(): Promise<void> {
  const user = useSession.getState().user;
  if (!user) return;
  const userId = user.id;
  const isWorker = user.roles.includes('WORKER');
  const seen = useLeagueSeen.getState().get(userId);

  const [workerStatus, clientStatus] = await Promise.all([
    isWorker ? getLeagueStatus().catch(() => null) : Promise.resolve(null),
    getClientLeagueStatus().catch(() => null),
  ]);

  if (workerStatus) {
    if (seen?.worker === undefined) {
      useLeagueSeen.getState().set(userId, { worker: workerStatus.league });
    } else if (LEAGUE_TIERS.indexOf(workerStatus.league) > LEAGUE_TIERS.indexOf(seen.worker)) {
      useLeagueUpQueue.getState().push({ kind: 'worker', league: workerStatus.league });
      useLeagueSeen.getState().set(userId, { worker: workerStatus.league });
    }
  }

  if (clientStatus) {
    if (seen?.client === undefined) {
      useLeagueSeen.getState().set(userId, { client: clientStatus.league });
    } else if (
      CLIENT_LEAGUE_TIERS.indexOf(clientStatus.league) > CLIENT_LEAGUE_TIERS.indexOf(seen.client)
    ) {
      useLeagueUpQueue.getState().push({ kind: 'client', league: clientStatus.league });
      useLeagueSeen.getState().set(userId, { client: clientStatus.league });
    }
  }
}
