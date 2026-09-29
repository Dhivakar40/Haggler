import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import i18n from '../../i18n';
import {
  iso,
  mockApi,
  type MockCall,
  renderWithProviders,
  routerMock,
  signInAs,
} from '../../test-utils';
import { useLocationTracker } from '../../location/tracker';
import { TrackerHost } from './TrackerHost';
import { WorkScreen } from './WorkScreen';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock('../../location/tracker', () => ({
  ensureForegroundPermission: jest.fn(async () => true),
  useLocationTracker: jest.fn(),
  defineBackgroundTask: jest.fn(),
}));
const loc = Location as unknown as Record<string, jest.Mock>;
const tracker = useLocationTracker as jest.Mock;
const { ensureForegroundPermission } = jest.requireMock('../../location/tracker') as {
  ensureForegroundPermission: jest.Mock;
};

const REQ1 = '11111111-aaaa-4aaa-8aaa-111111111111';
const incoming = (over = {}) => ({
  jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  requestId: REQ1,
  categorySlug: 'electrician',
  description: 'Ceiling fan sparks when switched on',
  city: 'Chennai',
  pincode: '600042',
  distanceM: 840,
  wave: 1,
  urgency: 'IMMEDIATE',
  scheduledFor: null,
  band: { scope: 'DEFAULT', minPaise: 19900, medianPaise: 34900, maxPaise: 69900 },
  deadline: iso(150_000),
  photoCount: 2,
  hasVoiceNote: true,
  ...over,
});

/** A fake Ranger backend that remembers whether they are online and what is waiting for them. */
function backend(
  over: {
    online?: boolean;
    incoming?: object[];
    jobs?: object[];
    onAccept?: (c: MockCall) => { status?: number; body?: unknown };
  } = {},
) {
  const state = { online: over.online ?? false, incoming: over.incoming ?? [] };
  const api = mockApi((c) => {
    if (c.path === '/v1/worker/presence') return { body: { isOnline: state.online } };
    if (c.path === '/v1/worker/online') {
      state.online = true;
      return { body: { isOnline: true } };
    }
    if (c.path === '/v1/worker/offline') {
      state.online = false;
      return { body: { isOnline: false } };
    }
    if (c.path === '/v1/worker/incoming') return { body: state.incoming };
    if (c.path === '/v1/worker/location') return { body: { ok: true } };
    if (c.path.startsWith('/v1/jobs'))
      return { body: { items: over.jobs ?? [], nextCursor: null } };
    if (c.path.endsWith('/accept'))
      return (
        over.onAccept?.(c) ?? {
          body: { jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', requestId: REQ1 },
        }
      );
    if (c.path.endsWith('/decline')) {
      state.incoming = [];
      return { body: { declined: true } };
    }
  });
  return { ...api, state };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  ensureForegroundPermission.mockResolvedValue(true);
  loc.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 13.0827, longitude: 80.2707 },
  });
  signInAs({ roles: ['CUSTOMER', 'WORKER'], workerKycTier: 2 });
});

describe('WorkScreen', () => {
  it('a Ranger below verification level 2 cannot go online and is sent to verification', async () => {
    signInAs({ roles: ['CUSTOMER', 'WORKER'], workerKycTier: 1 });
    mockApi(() => undefined);
    await renderWithProviders(<WorkScreen />);
    expect(screen.getByTestId('needs-verification')).toHaveTextContent(
      'Finish verification level 2 to go online.',
    );
    expect(screen.queryByTestId('toggle-online')).toBeNull();
    await fireEvent.press(screen.getByTestId('open-verification'));
    expect(routerMock().push).toHaveBeenCalledWith('/ranger');
  });

  it('starts offline; going online sends the real GPS position and then shows the waiting state', async () => {
    const { calls } = backend();
    await renderWithProviders(<WorkScreen />);
    expect(await screen.findByTestId('presence-label')).toHaveTextContent('You are offline');
    expect(screen.queryByText('New requests')).toBeNull();
    await fireEvent.press(screen.getByTestId('toggle-online'));
    await waitFor(() =>
      expect(screen.getByTestId('presence-label')).toHaveTextContent('You are online'),
    );
    expect(calls.find((c) => c.path === '/v1/worker/online')?.body).toEqual({
      latitude: 13.0827,
      longitude: 80.2707,
    });
    expect(await screen.findByText('Waiting for requests near you…')).toBeTruthy();
    expect(screen.getByText('Keep the app open to receive requests.')).toBeTruthy();
  });

  it('without location permission it does not go online and says why', async () => {
    ensureForegroundPermission.mockResolvedValue(false);
    const { calls } = backend();
    await renderWithProviders(<WorkScreen />);
    await fireEvent.press(await screen.findByTestId('toggle-online'));
    expect(await screen.findByTestId('work-error')).toHaveTextContent(
      'Turn on location to go online.',
    );
    expect(calls.some((c) => c.path === '/v1/worker/online')).toBe(false);
  });

  it('server refusal (e.g. no categories) is shown', async () => {
    mockApi((c) => {
      if (c.path === '/v1/worker/presence') return { body: { isOnline: false } };
      if (c.path === '/v1/worker/online')
        return {
          status: 422,
          body: {
            error: {
              code: 'UNPROCESSABLE',
              message: 'Choose the work you do before going online.',
            },
          },
        };
      return { body: { items: [], nextCursor: null } };
    });
    await renderWithProviders(<WorkScreen />);
    await fireEvent.press(await screen.findByTestId('toggle-online'));
    expect(await screen.findByTestId('work-error')).toBeTruthy();
    expect(screen.getByTestId('presence-label')).toHaveTextContent('You are offline');
  });

  it('going offline calls the server and hides the requests', async () => {
    const { calls } = backend({ online: true, incoming: [incoming()] });
    await renderWithProviders(<WorkScreen />);
    expect(await screen.findByTestId(`incoming-${REQ1}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('toggle-online'));
    await waitFor(() =>
      expect(screen.getByTestId('presence-label')).toHaveTextContent('You are offline'),
    );
    expect(calls.some((c) => c.path === '/v1/worker/offline')).toBe(true);
    expect(screen.queryByTestId(`incoming-${REQ1}`)).toBeNull();
  });

  it('shows an incoming request: category, distance, area (no street), price range, media and a countdown', async () => {
    backend({ online: true, incoming: [incoming()] });
    await renderWithProviders(<WorkScreen />);
    const card = await screen.findByTestId(`incoming-${REQ1}`);
    expect(card).toBeTruthy();
    expect(screen.getByText('Electrician')).toBeTruthy();
    expect(screen.getByText('Ceiling fan sparks when switched on')).toBeTruthy();
    expect(screen.getByText('840 m away · Chennai 600042')).toBeTruthy();
    expect(screen.getByTestId(`band-${REQ1}`)).toHaveTextContent('₹199 – ₹699');
    expect(screen.getByText('2 photos · Voice note')).toBeTruthy();
    expect(screen.getByTestId(`countdown-${REQ1}`).props.children).toMatch(/^2:[0-9]{2}$/);
  });

  it('formats long distances in km', async () => {
    backend({ online: true, incoming: [incoming({ distanceM: 3450 })] });
    await renderWithProviders(<WorkScreen />);
    expect(await screen.findByText('3.5 km away · Chennai 600042')).toBeTruthy();
  });

  it('accepting opens the job', async () => {
    const { calls } = backend({ online: true, incoming: [incoming()] });
    await renderWithProviders(<WorkScreen />);
    await fireEvent.press(await screen.findByTestId(`accept-${REQ1}`));
    await waitFor(() =>
      expect(routerMock().push).toHaveBeenCalledWith({
        pathname: '/job/[id]',
        params: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      }),
    );
    expect(calls.some((c) => c.method === 'POST' && c.path === `/v1/requests/${REQ1}/accept`)).toBe(
      true,
    );
  });

  it('losing the race: "That request was already taken." and the list refreshes', async () => {
    const be = backend({
      online: true,
      incoming: [incoming()],
      onAccept: () => ({
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'x', details: { code: 'REQUEST_TAKEN' } } },
      }),
    });
    await renderWithProviders(<WorkScreen />);
    await fireEvent.press(await screen.findByTestId(`accept-${REQ1}`));
    expect(await screen.findByTestId('work-error')).toHaveTextContent(
      'That request was already taken.',
    );
    expect(routerMock().push).not.toHaveBeenCalled();
    be.state.incoming = []; // the server no longer lists it
    await waitFor(() =>
      expect(be.calls.filter((c) => c.path === '/v1/worker/incoming').length).toBeGreaterThan(1),
    );
  });

  it('"You already have an active job" is explained', async () => {
    backend({
      online: true,
      incoming: [incoming()],
      onAccept: () => ({
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'x', details: { code: 'ALREADY_ON_JOB' } } },
      }),
    });
    await renderWithProviders(<WorkScreen />);
    await fireEvent.press(await screen.findByTestId(`accept-${REQ1}`));
    expect(await screen.findByTestId('work-error')).toHaveTextContent(
      'You already have an active job.',
    );
  });

  it('declining removes it from the list', async () => {
    const { calls } = backend({ online: true, incoming: [incoming()] });
    await renderWithProviders(<WorkScreen />);
    await fireEvent.press(await screen.findByTestId(`decline-${REQ1}`));
    await waitFor(() => expect(screen.queryByTestId(`incoming-${REQ1}`)).toBeNull());
    expect(
      calls.some((c) => c.method === 'POST' && c.path === `/v1/requests/${REQ1}/decline`),
    ).toBe(true);
  });

  it('with an active job it shows the job and hides new requests', async () => {
    backend({
      online: true,
      incoming: [incoming()],
      jobs: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          viewerRole: 'WORKER',
          status: 'EN_ROUTE',
          categorySlug: 'plumber',
          description: 'Leak',
          agreedPricePaise: 40000,
          createdAt: iso(-1000),
        },
      ],
    });
    await renderWithProviders(<WorkScreen />);
    expect(await screen.findByTestId('active-job')).toBeTruthy();
    expect(screen.getByText('Plumber · Your Ranger is on the way')).toBeTruthy();
    expect(screen.queryByTestId(`incoming-${REQ1}`)).toBeNull();
    await fireEvent.press(screen.getByTestId('open-active-job'));
    expect(routerMock().push).toHaveBeenCalledWith({
      pathname: '/job/[id]',
      params: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });
  });

  it('is translated (Kannada)', async () => {
    await i18n.changeLanguage('kn');
    backend();
    await renderWithProviders(<WorkScreen />);
    expect(await screen.findByText('ನೀವು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿದ್ದೀರಿ')).toBeTruthy();
  });
});

describe('TrackerHost (the single location streamer)', () => {
  const activeJob = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    viewerRole: 'WORKER',
    status: 'EN_ROUTE',
    categorySlug: 'plumber',
    description: 'Leak',
    agreedPricePaise: 40000,
    createdAt: iso(-1000),
  };
  const lastMode = () => tracker.mock.calls.at(-1) as [string, string | undefined, unknown];

  it('online with no job: a relaxed heartbeat', async () => {
    backend({ online: true });
    await renderWithProviders(<TrackerHost />);
    await waitFor(() => expect(lastMode()[0]).toBe('online'));
  });

  it('active job: the job cadence, with the job status so the cadence can adapt', async () => {
    backend({ online: true, jobs: [activeJob] });
    await renderWithProviders(<TrackerHost />);
    await waitFor(() => expect(lastMode().slice(0, 2)).toEqual(['job', 'EN_ROUTE']));
  });

  it('offline and idle: nothing is tracked (saves battery, and they are not reachable anyway)', async () => {
    backend({ online: false });
    await renderWithProviders(<TrackerHost />);
    await new Promise((r) => setTimeout(r, 50));
    expect(lastMode()[0]).toBe('off');
  });

  it('a customer who is not a Ranger is never tracked', async () => {
    signInAs({ roles: ['CUSTOMER'] });
    const { calls } = backend({ online: true });
    await renderWithProviders(<TrackerHost />);
    await new Promise((r) => setTimeout(r, 50));
    expect(lastMode()[0]).toBe('off');
    expect(calls.some((c) => c.path.startsWith('/v1/worker'))).toBe(false); // does not even ask
  });

  it('sends each fix over REST when the socket is not available', async () => {
    const { calls } = backend({ online: true });
    await renderWithProviders(<TrackerHost />);
    await waitFor(() => expect(tracker).toHaveBeenCalled());
    const send = lastMode()[2] as (p: {
      latitude: number;
      longitude: number;
      accuracyM?: number;
    }) => Promise<void>;
    await send({ latitude: 13.1, longitude: 80.2, accuracyM: 9 });
    expect(calls.find((c) => c.path === '/v1/worker/location')?.body).toEqual({
      latitude: 13.1,
      longitude: 80.2,
      accuracyM: 9,
    });
  });
});
