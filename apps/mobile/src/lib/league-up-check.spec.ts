import { mockApi, signInAs } from '../test-utils';
import { useLeagueSeen } from '../store/league-seen';
import { useLeagueUpQueue } from '../store/league-up-queue';
import { checkLeagueUp } from './league-up-check';

const leagueStatus = (over: Record<string, unknown> = {}) => ({
  league: 'STONE',
  nextLeague: 'COPPER',
  progress: 0.2,
  jobsCompleted: 1,
  ratingAvg: null,
  ratingCount: 0,
  cancellationRate: 0,
  ladder: [],
  ...over,
});
const clientLeagueStatus = (over: Record<string, unknown> = {}) => ({
  league: 'REGULAR',
  nextLeague: 'PREFERRED',
  progress: 0.2,
  bookingsCompleted: 1,
  ratingAvg: null,
  ratingCount: 0,
  cancellationRate: 0,
  ladder: [],
  ...over,
});

function backend(worker: object, client: object) {
  return mockApi((c) => {
    if (c.path === '/v1/worker/league') return { body: worker };
    if (c.path === '/v1/me/league') return { body: client };
  });
}

beforeEach(() => {
  useLeagueSeen.setState({ seen: {} });
  useLeagueUpQueue.setState({ queue: [] });
});

describe('checkLeagueUp', () => {
  it('a brand new user (first fetch ever) sets the baseline silently — no popup', async () => {
    signInAs({ id: 'u1', roles: ['CUSTOMER'] });
    backend(leagueStatus(), clientLeagueStatus({ league: 'NEWCOMER' }));
    await checkLeagueUp();
    expect(useLeagueUpQueue.getState().queue).toHaveLength(0);
    expect(useLeagueSeen.getState().get('u1')).toEqual({ client: 'NEWCOMER' });
  });

  it('queues a worker league-up only when the fresh league ranks above the stored one', async () => {
    signInAs({ id: 'u1', roles: ['WORKER', 'CUSTOMER'] });
    useLeagueSeen.getState().set('u1', { worker: 'STONE', client: 'REGULAR' });
    backend(leagueStatus({ league: 'COPPER' }), clientLeagueStatus());
    await checkLeagueUp();
    expect(useLeagueUpQueue.getState().queue).toEqual([{ kind: 'worker', league: 'COPPER' }]);
    expect(useLeagueSeen.getState().get('u1')).toEqual({ worker: 'COPPER', client: 'REGULAR' });
  });

  it('does not queue anything when the league is unchanged or has dropped', async () => {
    signInAs({ id: 'u1', roles: ['WORKER', 'CUSTOMER'] });
    useLeagueSeen.getState().set('u1', { worker: 'GOLD', client: 'ELITE' });
    backend(leagueStatus({ league: 'GOLD' }), clientLeagueStatus({ league: 'TRUSTED' }));
    await checkLeagueUp();
    expect(useLeagueUpQueue.getState().queue).toHaveLength(0);
  });

  it('a non-worker never calls the worker league endpoint, but still checks the client one', async () => {
    signInAs({ id: 'u1', roles: ['CUSTOMER'] });
    useLeagueSeen.getState().set('u1', { client: 'REGULAR' });
    const { calls } = backend(leagueStatus(), clientLeagueStatus({ league: 'PREFERRED' }));
    await checkLeagueUp();
    expect(calls.some((c) => c.path === '/v1/worker/league')).toBe(false);
    expect(useLeagueUpQueue.getState().queue).toEqual([{ kind: 'client', league: 'PREFERRED' }]);
  });

  it('skipping several leagues at once queues only the highest one reached', async () => {
    signInAs({ id: 'u1', roles: ['WORKER', 'CUSTOMER'] });
    useLeagueSeen.getState().set('u1', { worker: 'STONE', client: 'REGULAR' });
    backend(leagueStatus({ league: 'SILVER' }), clientLeagueStatus());
    await checkLeagueUp();
    expect(useLeagueUpQueue.getState().queue).toEqual([{ kind: 'worker', league: 'SILVER' }]);
  });

  it('is keyed per user id: switching accounts never leaks the previous account\'s baseline', async () => {
    signInAs({ id: 'u1', roles: ['CUSTOMER'] });
    useLeagueSeen.getState().set('u1', { client: 'PATRON' });
    signInAs({ id: 'u2', roles: ['CUSTOMER'] });
    backend(leagueStatus(), clientLeagueStatus({ league: 'REGULAR' }));
    await checkLeagueUp();
    // u2 has never been seen before, so this is a silent baseline-set, not a (nonsensical) demotion.
    expect(useLeagueUpQueue.getState().queue).toHaveLength(0);
    expect(useLeagueSeen.getState().get('u2')).toEqual({ client: 'REGULAR' });
    expect(useLeagueSeen.getState().get('u1')).toEqual({ client: 'PATRON' });
  });
});
