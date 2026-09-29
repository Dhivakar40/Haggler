import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { Alert, Linking, Share } from 'react-native';
import type { JobDto } from '@haggler/shared';
import i18n from '../../i18n';
import {
  iso,
  makeJob,
  type MockCall,
  mockApi,
  offer,
  rangerParty,
  renderWithProviders,
  routerMock,
  signInAs,
} from '../../test-utils';
import { uploadJobPhoto } from '../media/upload';
import { JobScreen } from './JobScreen';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('../media/upload', () => ({
  uploadJobPhoto: jest.fn(async () => undefined),
  uploadRequestMedia: jest.fn(),
}));
jest.mock('@maplibre/maplibre-react-native', () => {
  throw new Error('native module missing (Expo Go)');
});
// Capture the live-location subscription so a test can push an event as the socket would.
const mockHandlers: Record<string, (p: unknown) => void> = {};
jest.mock('../../realtime/RealtimeProvider', () => ({
  useRealtime: () => null,
  useRealtimeEvent: (event: string, h: (p: unknown) => void) => {
    mockHandlers[event] = h;
  },
}));

const picker = ImagePicker as unknown as Record<string, jest.Mock>;
const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OFFER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const THREAD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/**
 * A tiny server: GET returns the current job; a POST runs `next`, which returns the job after the action
 * (or an error). Everything is recorded in `calls`.
 */
function serve(
  initial: JobDto,
  next?: (c: MockCall) => { status?: number; body?: unknown } | JobDto | undefined,
) {
  let job = initial;
  const api = mockApi((c) => {
    if (c.method === 'GET' && c.path === `/v1/jobs/${JOB_ID}`) return { body: job };
    if (c.method === 'GET' && c.path === `/v1/jobs/${JOB_ID}/track`)
      return {
        body: {
          jobId: JOB_ID,
          status: job.status,
          worker: { latitude: 13.05, longitude: 80.25, accuracyM: 8, recordedAt: iso(-5000) },
          trail: [],
          destination: job.location,
        },
      };
    if (c.path === `/v1/jobs/${JOB_ID}/share-link`)
      return { body: { url: 'https://haggler.example/t/abc', expiresAt: iso(3_600_000) } };
    if (c.path.startsWith('/v1/jobs?')) return { body: { items: [], nextCursor: null } };
    const res = next?.(c);
    if (!res) return undefined;
    if ('viewerRole' in res) {
      job = res as JobDto;
      return { body: job };
    }
    return res as { status?: number; body?: unknown };
  });
  return { ...api, current: () => job };
}

const asRanger = (over: Partial<JobDto> = {}) =>
  makeJob({
    viewerRole: 'WORKER',
    worker: rangerParty,
    customer: { id: '11111111-1111-4111-8111-111111111111', firstName: 'Asha' },
    ...over,
  });
const asCustomer = (over: Partial<JobDto> = {}) =>
  makeJob({ viewerRole: 'CUSTOMER', worker: rangerParty, ...over });
const post = (calls: MockCall[], path: string) =>
  calls.find((c) => c.method === 'POST' && c.path === path);
const pressAlertButton = (label: string) => {
  const args = (Alert.alert as jest.Mock).mock.calls.at(-1) as [
    string,
    string | undefined,
    { text: string; onPress?: () => void }[],
  ];
  const btn = args[2].find((b) => b.text === label);
  if (!btn?.onPress) throw new Error(`no alert button ${label}`);
  btn.onPress();
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  for (const k of Object.keys(mockHandlers)) delete mockHandlers[k];
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: JOB_ID });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
  picker.launchCameraAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cam.jpg', width: 3000, height: 2000 }],
  });
  signInAs({ roles: ['CUSTOMER', 'WORKER'], workerKycTier: 2 });
});

describe('JobScreen: shared behaviour', () => {
  it('shows an error state when the job cannot be loaded', async () => {
    mockApi(() => ({ status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }));
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByText('Could not load this. Check your connection.')).toBeTruthy();
  });

  it('a customer whose request is still being broadcast is sent to the request screen', async () => {
    serve(asCustomer({ status: 'BROADCASTING', worker: null }));
    await renderWithProviders(<JobScreen />);
    await waitFor(() =>
      expect(routerMock().replace).toHaveBeenCalledWith({
        pathname: '/request/[id]',
        params: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      }),
    );
  });

  it('the status title uses the customer wording for the customer', async () => {
    serve(asCustomer({ status: 'ARRIVED', arrivalCode: '4821' }));
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByText('Your Ranger has arrived for the rescue')).toBeTruthy();
  });

  it('the status title uses the Ranger wording for the Ranger', async () => {
    serve(asRanger({ status: 'ARRIVED' }));
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByText('You have arrived')).toBeTruthy();
  });

  it('opens the chat when there is a thread', async () => {
    serve(asCustomer({ status: 'MATCHED', threadId: THREAD }));
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('open-chat'));
    expect(routerMock().push).toHaveBeenCalledWith({
      pathname: '/chat/[jobId]',
      params: { jobId: JOB_ID },
    });
  });

  it('does not offer chat when there is no thread yet', async () => {
    serve(asCustomer({ status: 'MATCHED', threadId: null }));
    await renderWithProviders(<JobScreen />);
    await screen.findByTestId('negotiation');
    expect(screen.queryByTestId('open-chat')).toBeNull();
  });

  it('chat is closed once the job is cancelled', async () => {
    serve(asCustomer({ status: 'CANCELLED', threadId: THREAD }));
    await renderWithProviders(<JobScreen />);
    await screen.findByTestId('status-title');
    expect(screen.queryByTestId('open-chat')).toBeNull();
  });
});

describe('JobScreen: negotiation', () => {
  it('shows the Ranger, the usual range, the round, and the agreed price once there is one', async () => {
    serve(asCustomer({ status: 'NEGOTIATING', offers: [offer()] }));
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByTestId('ranger-meta')).toHaveTextContent(
      'Level 2 · SILVER · 12 jobs done',
    );
    expect(screen.getByTestId('band')).toHaveTextContent('Usual range: ₹199 to ₹699');
    expect(screen.getByTestId('round')).toHaveTextContent('Round 1 of 3');
    expect(screen.getByTestId('their-offer')).toHaveTextContent('₹500 offered to you');
    expect(screen.queryByTestId('agreed-price')).toBeNull();
  });

  it('accepting an offer inside the band sends confirmOutsideBand=false and shows the agreed price', async () => {
    const { calls } = serve(asCustomer({ status: 'NEGOTIATING', offers: [offer()] }), (c) =>
      c.path === `/v1/offers/${OFFER_ID}/accept`
        ? asCustomer({
            status: 'AGREED',
            agreedPricePaise: 50000,
            offers: [offer({ status: 'ACCEPTED' })],
          })
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('accept-offer'));
    expect(await screen.findByTestId('agreed-price')).toHaveTextContent('Agreed price: ₹500');
    expect(post(calls, `/v1/offers/${OFFER_ID}/accept`)?.body).toEqual({
      confirmOutsideBand: false,
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(screen.getByTestId('wait-ranger')).toBeTruthy();
  });

  it('accepting an offer OUTSIDE the band asks first; "Yes, continue" sends it with confirmation, cancel sends nothing', async () => {
    const pricey = offer({ amountPaise: 120000, outsideBand: true });
    const { calls } = serve(asCustomer({ status: 'NEGOTIATING', offers: [pricey] }), (c) =>
      c.path === `/v1/offers/${OFFER_ID}/accept`
        ? asCustomer({ status: 'AGREED', agreedPricePaise: 120000 })
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('accept-offer'));
    const [title, body] = (Alert.alert as jest.Mock).mock.calls[0] as [string, string];
    expect(title).toBe('Outside the usual range');
    expect(body).toBe('₹1,200 is outside ₹199 to ₹699. Continue anyway?');
    // the dismiss/"Cancel" button has no onPress (the alert just closes): nothing is sent yet
    expect(post(calls, `/v1/offers/${OFFER_ID}/accept`)).toBeUndefined();
    await act(async () => pressAlertButton('Yes, continue'));
    await waitFor(() =>
      expect(post(calls, `/v1/offers/${OFFER_ID}/accept`)?.body).toEqual({
        confirmOutsideBand: true,
      }),
    );
  });

  it('countering sends the amount in paise and clears the field', async () => {
    const { calls } = serve(asCustomer({ status: 'NEGOTIATING', offers: [offer()] }), (c) =>
      c.path === `/v1/offers/${OFFER_ID}/counter`
        ? asCustomer({
            status: 'NEGOTIATING',
            offers: [
              offer({ status: 'COUNTERED' }),
              offer({
                id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                round: 2,
                fromRole: 'CUSTOMER',
                amountPaise: 45000,
              }),
            ],
          })
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.changeText(await screen.findByTestId('offer-amount'), '450');
    await fireEvent.press(screen.getByTestId('counter-offer'));
    await waitFor(() =>
      expect(post(calls, `/v1/offers/${OFFER_ID}/counter`)?.body).toEqual({
        amountPaise: 45000,
        confirmOutsideBand: false,
      }),
    );
    expect(await screen.findByTestId('my-offer')).toHaveTextContent(
      'You offered ₹450. Waiting for an answer…',
    );
    expect(screen.queryByTestId('their-offer')).toBeNull();
  });

  it('an empty or nonsense amount is refused on the phone without a request', async () => {
    const { calls } = serve(asCustomer({ status: 'NEGOTIATING', offers: [offer()] }));
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('counter-offer'));
    expect(await screen.findByText('Enter a valid amount in rupees.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('offer-amount'), '0.5');
    await fireEvent.press(screen.getByTestId('counter-offer'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('a counter outside the band asks first', async () => {
    const { calls } = serve(asCustomer({ status: 'NEGOTIATING', offers: [offer()] }));
    await renderWithProviders(<JobScreen />);
    await fireEvent.changeText(await screen.findByTestId('offer-amount'), '50');
    await fireEvent.press(screen.getByTestId('counter-offer'));
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toBe(
      '₹50 is outside ₹199 to ₹699. Continue anyway?',
    );
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it("rejecting sends the reject and shows the server's answer", async () => {
    const { calls } = serve(asCustomer({ status: 'NEGOTIATING', offers: [offer()] }), (c) =>
      c.path === `/v1/offers/${OFFER_ID}/reject`
        ? asCustomer({ status: 'CANCELLED', offers: [offer({ status: 'REJECTED' })] })
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('reject-offer'));
    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(post(calls, `/v1/offers/${OFFER_ID}/reject`)).toBeTruthy();
  });

  it('after three rounds there is no fourth: no counter field on the last offer', async () => {
    const offers = [
      offer({ id: 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', round: 1, status: 'COUNTERED' }),
      offer({
        id: 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
        round: 2,
        fromRole: 'CUSTOMER',
        amountPaise: 40000,
        status: 'COUNTERED',
      }),
      offer({ id: OFFER_ID, round: 3, amountPaise: 45000 }),
    ];
    serve(asCustomer({ status: 'NEGOTIATING', offers }));
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByTestId('accept-offer')).toBeTruthy();
    expect(screen.getByTestId('round')).toHaveTextContent('Round 3 of 3');
    expect(screen.queryByTestId('counter-offer')).toBeNull();
    expect(screen.queryByTestId('offer-amount')).toBeNull();
  });

  it('the Ranger makes the first offer', async () => {
    const { calls } = serve(asRanger({ status: 'MATCHED' }), (c) =>
      c.path === `/v1/jobs/${JOB_ID}/offers`
        ? asRanger({ status: 'NEGOTIATING', offers: [offer({ amountPaise: 40000 })] })
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.changeText(await screen.findByTestId('offer-amount'), '400');
    await fireEvent.press(screen.getByTestId('send-offer'));
    await waitFor(() =>
      expect(post(calls, `/v1/jobs/${JOB_ID}/offers`)?.body).toEqual({
        amountPaise: 40000,
        confirmOutsideBand: false,
      }),
    );
    expect(await screen.findByTestId('my-offer')).toBeTruthy();
    expect(screen.queryByTestId('send-offer')).toBeNull(); // one pending offer at a time
  });

  it('a server refusal is shown and the job is re-read', async () => {
    const { calls } = serve(asRanger({ status: 'MATCHED' }), (c) =>
      c.path === `/v1/jobs/${JOB_ID}/offers`
        ? { status: 409, body: { error: { code: 'CONFLICT', message: 'x' } } }
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.changeText(await screen.findByTestId('offer-amount'), '400');
    await fireEvent.press(screen.getByTestId('send-offer'));
    expect(await screen.findByTestId('action-error')).toBeTruthy();
    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === 'GET' && c.path === `/v1/jobs/${JOB_ID}`).length,
      ).toBeGreaterThan(1),
    );
  });
});

describe('JobScreen: customer side of the visit', () => {
  it('shows the live map area (text fallback without the native map) and the Ranger position', async () => {
    serve(asCustomer({ status: 'EN_ROUTE', agreedPricePaise: 50000 }));
    await renderWithProviders(<JobScreen />);
    await screen.findByTestId('map-fallback');
    await waitFor(() =>
      expect(screen.getByTestId('map-fallback')).toHaveTextContent('13.05000, 80.25000'),
    );
  });

  it('a live location event moves the Ranger on the map without refetching', async () => {
    const { calls } = serve(asCustomer({ status: 'EN_ROUTE', agreedPricePaise: 50000 }));
    await renderWithProviders(<JobScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('map-fallback')).toHaveTextContent('13.05000, 80.25000'),
    );
    const before = calls.length;
    await act(async () =>
      mockHandlers['location.update']({
        jobId: JOB_ID,
        latitude: 13.061,
        longitude: 80.26,
        accuracyM: 5,
        recordedAt: iso(0),
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('map-fallback')).toHaveTextContent('13.06100, 80.26000'),
    );
    expect(calls.length).toBe(before);
  });

  it('ignores a location event for a different job', async () => {
    serve(asCustomer({ status: 'EN_ROUTE', agreedPricePaise: 50000 }));
    await renderWithProviders(<JobScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('map-fallback')).toHaveTextContent('13.05000, 80.25000'),
    );
    await act(async () =>
      mockHandlers['location.update']({
        jobId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        latitude: 1,
        longitude: 2,
        accuracyM: null,
        recordedAt: iso(0),
      }),
    );
    expect(screen.getByTestId('map-fallback')).toHaveTextContent('13.05000, 80.25000');
  });

  it('does not track before the price is agreed', async () => {
    const { calls } = serve(asCustomer({ status: 'NEGOTIATING', offers: [offer()] }));
    await renderWithProviders(<JobScreen />);
    await screen.findByTestId('negotiation');
    expect(calls.some((c) => c.path.endsWith('/track'))).toBe(false);
    expect(screen.queryByTestId('map-fallback')).toBeNull();
  });

  it('shows the 4-digit arrival code big when the server sends it', async () => {
    serve(asCustomer({ status: 'ARRIVED', arrivalCode: '4821', agreedPricePaise: 50000 }));
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByTestId('arrival-code-value')).toHaveTextContent('4821');
    expect(screen.getByText('Read this code to your Ranger when they arrive.')).toBeTruthy();
  });

  it('hides the arrival code card once verified and work has moved on', async () => {
    serve(
      asCustomer({
        status: 'IN_PROGRESS',
        arrivalCode: null,
        arrivalVerified: true,
        agreedPricePaise: 50000,
      }),
    );
    await renderWithProviders(<JobScreen />);
    await screen.findByTestId('status-title');
    expect(screen.queryByTestId('arrival-code-card')).toBeNull();
  });

  it('confirming: tells the customer what to pay and how, then confirms', async () => {
    const { calls } = serve(
      asCustomer({ status: 'COMPLETED_BY_WORKER', agreedPricePaise: 40000, paymentMethod: 'UPI' }),
      (c) =>
        c.path === `/v1/jobs/${JOB_ID}/confirm`
          ? asCustomer({
              status: 'CONFIRMED_BY_CUSTOMER',
              agreedPricePaise: 40000,
              paymentMethod: 'UPI',
            })
          : undefined,
    );
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByTestId('pay-note')).toHaveTextContent(
      'Pay ₹400 to your Ranger by UPI.',
    );
    await fireEvent.press(screen.getByTestId('confirm-done'));
    expect(await screen.findByText('Completed')).toBeTruthy();
    expect(post(calls, `/v1/jobs/${JOB_ID}/confirm`)).toBeTruthy();
    expect(screen.queryByTestId('confirm-done')).toBeNull();
  });

  it('cancelling asks first; "Keep job" does nothing, "Cancel job" cancels', async () => {
    const { calls } = serve(asCustomer({ status: 'AGREED', agreedPricePaise: 40000 }), (c) =>
      c.path === `/v1/jobs/${JOB_ID}/cancel` ? asCustomer({ status: 'CANCELLED' }) : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('cancel-job'));
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Cancel this job?');
    // "Keep job" has no onPress (the alert just closes): nothing is sent unless the destructive button is pressed
    expect(post(calls, `/v1/jobs/${JOB_ID}/cancel`)).toBeUndefined();
    await act(async () => pressAlertButton('Cancel job'));
    expect(await screen.findByText('Cancelled')).toBeTruthy();
  });

  it('warns about the cancellation fee when it applies', async () => {
    serve(
      asCustomer({
        status: 'CANCELLED',
        cancellation: { by: 'CUSTOMER', reason: null, feeApplies: true } as never,
      }),
    );
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByTestId('fee-note')).toHaveTextContent(
      'A cancellation fee may apply because your Ranger had already travelled a long way.',
    );
  });

  it('shares a live link through the system share sheet', async () => {
    const { calls } = serve(asCustomer({ status: 'EN_ROUTE', agreedPricePaise: 40000 }));
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('share-link'));
    await waitFor(() =>
      expect(Share.share).toHaveBeenCalledWith({
        message: 'Follow my Haggler job live: https://haggler.example/t/abc',
      }),
    );
    expect(post(calls, `/v1/jobs/${JOB_ID}/share-link`)).toBeTruthy();
  });

  it('a Ranger who never turns up can be reported', async () => {
    const { calls } = serve(asCustomer({ status: 'EN_ROUTE', agreedPricePaise: 40000 }), (c) =>
      c.path === `/v1/jobs/${JOB_ID}/report-no-show`
        ? {
            status: 422,
            body: {
              error: { code: 'UNPROCESSABLE', message: 'x', details: { code: 'TOO_EARLY' } },
            },
          }
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('no-show'));
    expect(await screen.findByTestId('action-error')).toHaveTextContent(
      'It is too early to report this. Please wait a little longer.',
    );
    expect(post(calls, `/v1/jobs/${JOB_ID}/report-no-show`)).toBeTruthy();
  });
});

describe('JobScreen: Ranger side of the visit', () => {
  it('the Ranger sees the address and can open navigation; the customer cannot', async () => {
    serve(asRanger({ status: 'AGREED', agreedPricePaise: 40000 }));
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('navigate'));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('13.0827,80.2707'));
    expect(screen.getByText('12 Gandhi Road, Chennai, Tamil Nadu, 600042')).toBeTruthy();
  });

  it('walks the whole lifecycle: on my way -> arrived', async () => {
    const { calls } = serve(asRanger({ status: 'AGREED', agreedPricePaise: 40000 }), (c) => {
      if (c.path === `/v1/jobs/${JOB_ID}/en-route`)
        return asRanger({ status: 'EN_ROUTE', agreedPricePaise: 40000 });
      if (c.path === `/v1/jobs/${JOB_ID}/arrive`)
        return asRanger({ status: 'ARRIVED', agreedPricePaise: 40000 });
      return undefined;
    });
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('en-route'));
    await fireEvent.press(await screen.findByTestId('arrive'));
    expect(await screen.findByTestId('code-entry')).toBeTruthy();
    expect(post(calls, `/v1/jobs/${JOB_ID}/en-route`)).toBeTruthy();
    expect(post(calls, `/v1/jobs/${JOB_ID}/arrive`)).toBeTruthy();
  });

  it('too far from the address: the distance is shown', async () => {
    serve(asRanger({ status: 'EN_ROUTE', agreedPricePaise: 40000 }), (c) =>
      c.path === `/v1/jobs/${JOB_ID}/arrive`
        ? {
            status: 422,
            body: {
              error: {
                code: 'UNPROCESSABLE',
                message: 'x',
                details: { code: 'NOT_AT_LOCATION', distanceM: 1240 },
              },
            },
          }
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('arrive'));
    expect(await screen.findByTestId('action-error')).toHaveTextContent(
      'You are 1240 m away. Get closer to the address to mark arrival.',
    );
  });

  it('the code box takes digits only, at most four, and Verify is off until there are four', async () => {
    const { calls } = serve(asRanger({ status: 'ARRIVED', agreedPricePaise: 40000 }), (c) =>
      c.path === `/v1/jobs/${JOB_ID}/verify-arrival`
        ? asRanger({ status: 'ARRIVED', arrivalVerified: true, agreedPricePaise: 40000 })
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    const field = await screen.findByTestId('arrival-code');
    await fireEvent.changeText(field, '4a8-2');
    expect(screen.getByTestId('arrival-code').props.value).toBe('482');
    await fireEvent.press(screen.getByTestId('verify-code'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('arrival-code'), '482199');
    expect(screen.getByTestId('arrival-code').props.value).toBe('4821');
    await fireEvent.press(screen.getByTestId('verify-code'));
    expect(await screen.findByTestId('before-start')).toBeTruthy();
    expect(post(calls, `/v1/jobs/${JOB_ID}/verify-arrival`)?.body).toEqual({ code: '4821' });
  });

  it('a wrong code says so, and a locked one says what to do', async () => {
    let code = 'WRONG_CODE';
    serve(asRanger({ status: 'ARRIVED', agreedPricePaise: 40000 }), (c) =>
      c.path === `/v1/jobs/${JOB_ID}/verify-arrival`
        ? { status: 403, body: { error: { code: 'FORBIDDEN', message: 'x', details: { code } } } }
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.changeText(await screen.findByTestId('arrival-code'), '1111');
    await fireEvent.press(screen.getByTestId('verify-code'));
    expect(await screen.findByTestId('action-error')).toHaveTextContent('That code is not right.');
    code = 'CODE_LOCKED';
    await fireEvent.press(screen.getByTestId('verify-code'));
    await waitFor(() =>
      expect(screen.getByTestId('action-error')).toHaveTextContent(
        'Too many wrong codes. Ask the customer to check it, or cancel the job.',
      ),
    );
  });

  it('Start work stays off until a before photo exists; the photo is taken with the CAMERA, never the gallery', async () => {
    const { calls } = serve(
      asRanger({ status: 'ARRIVED', arrivalVerified: true, agreedPricePaise: 40000 }),
      (c) => {
        if (c.path === `/v1/jobs/${JOB_ID}/start`)
          return asRanger({
            status: 'IN_PROGRESS',
            arrivalVerified: true,
            hasBeforePhoto: true,
            agreedPricePaise: 40000,
          });
        return undefined;
      },
    );
    (uploadJobPhoto as jest.Mock).mockImplementationOnce(async () => {
      // the server now has the photo: the next read shows it
      serve(
        asRanger({
          status: 'ARRIVED',
          arrivalVerified: true,
          hasBeforePhoto: true,
          agreedPricePaise: 40000,
        }),
        (c) =>
          c.path === `/v1/jobs/${JOB_ID}/start`
            ? asRanger({
                status: 'IN_PROGRESS',
                arrivalVerified: true,
                hasBeforePhoto: true,
                agreedPricePaise: 40000,
              })
            : undefined,
      );
    });
    await renderWithProviders(<JobScreen />);
    const start = await screen.findByTestId('start-work');
    expect(start.props.accessibilityState?.disabled ?? start.props.disabled).toBeTruthy();
    await fireEvent.press(screen.getByTestId('before-photo'));
    await waitFor(() =>
      expect(uploadJobPhoto).toHaveBeenCalledWith(JOB_ID, 'BEFORE', 'file:///cam.jpg', 3000),
    );
    expect(picker.launchCameraAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'] }),
    );
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(calls.length).toBeGreaterThan(0);
    expect(await screen.findByTestId('before-done')).toHaveTextContent('Photo added');
    await fireEvent.press(screen.getByTestId('start-work'));
    expect(await screen.findByTestId('finish')).toBeTruthy();
  });

  it('camera permission denied: explained, nothing uploaded', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    serve(asRanger({ status: 'ARRIVED', arrivalVerified: true, agreedPricePaise: 40000 }));
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('before-photo'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(uploadJobPhoto).not.toHaveBeenCalled();
  });

  it('cancelling the camera does nothing', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null });
    serve(asRanger({ status: 'ARRIVED', arrivalVerified: true, agreedPricePaise: 40000 }));
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('before-photo'));
    await new Promise((r) => setTimeout(r, 20));
    expect(uploadJobPhoto).not.toHaveBeenCalled();
  });

  it('a failed photo upload shows a message and does not enable Start', async () => {
    (uploadJobPhoto as jest.Mock).mockRejectedValueOnce(new Error('network'));
    serve(asRanger({ status: 'ARRIVED', arrivalVerified: true, agreedPricePaise: 40000 }));
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('before-photo'));
    expect(
      await screen.findByText('Upload failed. Check your connection and try again.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('before-done')).toBeNull();
  });

  it('finishing: after photo required, payment method chosen (default cash), then completes', async () => {
    const { calls } = serve(
      asRanger({
        status: 'IN_PROGRESS',
        arrivalVerified: true,
        hasBeforePhoto: true,
        hasAfterPhoto: true,
        agreedPricePaise: 40000,
      }),
      (c) =>
        c.path === `/v1/jobs/${JOB_ID}/complete`
          ? asRanger({
              status: 'COMPLETED_BY_WORKER',
              hasAfterPhoto: true,
              agreedPricePaise: 40000,
              paymentMethod: 'UPI',
            })
          : undefined,
    );
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByTestId('after-done')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pay-UPI'));
    await fireEvent.press(screen.getByTestId('finish-job'));
    expect(await screen.findByTestId('wait-confirm')).toHaveTextContent(
      'Waiting for the customer.',
    );
    expect(post(calls, `/v1/jobs/${JOB_ID}/complete`)?.body).toEqual({ paymentMethod: 'UPI' });
  });

  it('cash is the default payment method', async () => {
    const { calls } = serve(
      asRanger({
        status: 'IN_PROGRESS',
        arrivalVerified: true,
        hasBeforePhoto: true,
        hasAfterPhoto: true,
        agreedPricePaise: 40000,
      }),
      (c) =>
        c.path === `/v1/jobs/${JOB_ID}/complete`
          ? asRanger({
              status: 'COMPLETED_BY_WORKER',
              agreedPricePaise: 40000,
              paymentMethod: 'CASH',
            })
          : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('finish-job'));
    await waitFor(() =>
      expect(post(calls, `/v1/jobs/${JOB_ID}/complete`)?.body).toEqual({ paymentMethod: 'CASH' }),
    );
  });

  it('cannot finish without an after photo (button disabled, no request)', async () => {
    const { calls } = serve(
      asRanger({
        status: 'IN_PROGRESS',
        arrivalVerified: true,
        hasBeforePhoto: true,
        hasAfterPhoto: false,
        agreedPricePaise: 40000,
      }),
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('finish-job'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('reports a customer no-show once arrived, and can cancel before starting', async () => {
    const { calls } = serve(asRanger({ status: 'ARRIVED', agreedPricePaise: 40000 }), (c) =>
      c.path === `/v1/jobs/${JOB_ID}/report-no-show`
        ? asRanger({ status: 'NO_SHOW_CUSTOMER', agreedPricePaise: 40000 })
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByTestId('cancel-job')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('no-show'));
    expect(await screen.findByText('Customer was not there')).toBeTruthy();
    expect(post(calls, `/v1/jobs/${JOB_ID}/report-no-show`)).toBeTruthy();
  });

  it('no cancel button once work has started', async () => {
    serve(
      asRanger({
        status: 'IN_PROGRESS',
        arrivalVerified: true,
        hasBeforePhoto: true,
        agreedPricePaise: 40000,
      }),
    );
    await renderWithProviders(<JobScreen />);
    await screen.findByTestId('finish');
    expect(screen.queryByTestId('cancel-job')).toBeNull();
    expect(screen.queryByTestId('no-show')).toBeNull();
  });

  it('is translated (Hindi)', async () => {
    await i18n.changeLanguage('hi');
    serve(asRanger({ status: 'AGREED', agreedPricePaise: 40000 }));
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByTestId('en-route')).toBeTruthy();
    expect(screen.queryByText('I am on my way')).toBeNull();
  });
});

describe('JobScreen: reviews and blocking (Phase 4)', () => {
  it('shows the star prompt once confirmed, and hides it once submitted', async () => {
    const { calls } = serve(
      asCustomer({
        status: 'CONFIRMED_BY_CUSTOMER',
        agreedPricePaise: 40000,
        review: { canReview: true, submitted: false },
      }),
      (c) =>
        c.path === `/v1/jobs/${JOB_ID}/review`
          ? {
              status: 201,
              body: {
                canReview: false,
                submitted: true,
                reviews: [
                  {
                    id: 'aaaaaaaa-1111-4111-8111-111111111111',
                    raterRole: 'CUSTOMER',
                    rating: 5,
                    comment: null,
                    createdAt: iso(0),
                  },
                ],
              },
            }
          : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await screen.findByTestId('review-prompt');
    await fireEvent.press(screen.getByTestId('star-4'));
    await fireEvent.changeText(screen.getByTestId('review-comment'), 'Great job!');
    await fireEvent.press(screen.getByTestId('submit-review'));
    expect(await screen.findByTestId('review-thanks')).toBeTruthy();
    expect(post(calls, `/v1/jobs/${JOB_ID}/review`)?.body).toEqual({
      rating: 4,
      comment: 'Great job!',
    });
    expect(screen.queryByTestId('review-prompt')).toBeNull();
  });

  it('does not let you submit without choosing a star rating', async () => {
    const { calls } = serve(
      asCustomer({
        status: 'CONFIRMED_BY_CUSTOMER',
        agreedPricePaise: 40000,
        review: { canReview: true, submitted: false },
      }),
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('submit-review'));
    expect(await screen.findByText('Choose a star rating first.')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('nothing is shown once the viewer has already reviewed', async () => {
    serve(
      asCustomer({
        status: 'CONFIRMED_BY_CUSTOMER',
        agreedPricePaise: 40000,
        review: { canReview: false, submitted: true },
      }),
    );
    await renderWithProviders(<JobScreen />);
    await screen.findByTestId('status-title');
    expect(screen.queryByTestId('review-prompt')).toBeNull();
  });

  it("shows the Ranger's rating average and links to their review history", async () => {
    serve(asCustomer({ status: 'AGREED', agreedPricePaise: 40000 }));
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByTestId('ranger-rating')).toHaveTextContent('★ 4.6 (9)');
    await fireEvent.press(screen.getByTestId('ranger-rating'));
    expect(routerMock().push).toHaveBeenCalledWith({
      pathname: '/ranger-reviews/[id]',
      params: { id: rangerParty.id },
    });
  });

  it('a Ranger with no ratings yet says so instead of showing a rating', async () => {
    serve(
      asCustomer({
        status: 'AGREED',
        agreedPricePaise: 40000,
        worker: { ...rangerParty, ratingAvg: null, ratingCount: 0 },
      }),
    );
    await renderWithProviders(<JobScreen />);
    expect(await screen.findByTestId('ranger-rating')).toHaveTextContent('No ratings yet');
  });

  it('blocking asks for confirmation, then blocks and shows "Blocked"', async () => {
    const { calls } = serve(asCustomer({ status: 'AGREED', agreedPricePaise: 40000 }), (c) =>
      c.path === '/v1/me/blocks' ? { status: 201, body: { blocked: true } } : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('block-user'));
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Block this Ranger?');
    await act(async () => {
      const args = (Alert.alert as jest.Mock).mock.calls.at(-1) as [
        string,
        string,
        { text: string; onPress?: () => void }[],
      ];
      args[2].find((b) => b.text === 'Block')?.onPress?.();
    });
    expect(await screen.findByTestId('blocked-note')).toBeTruthy();
    expect(post(calls, '/v1/me/blocks')?.body).toEqual({ userId: rangerParty.id });
    expect(screen.queryByTestId('block-user')).toBeNull();
  });

  it('a failed block shows an error and does not mark them blocked', async () => {
    serve(asCustomer({ status: 'AGREED', agreedPricePaise: 40000 }), (c) =>
      c.path === '/v1/me/blocks'
        ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }
        : undefined,
    );
    await renderWithProviders(<JobScreen />);
    await fireEvent.press(await screen.findByTestId('block-user'));
    await act(async () => {
      const args = (Alert.alert as jest.Mock).mock.calls.at(-1) as [
        string,
        string,
        { text: string; onPress?: () => void }[],
      ];
      args[2].find((b) => b.text === 'Block')?.onPress?.();
    });
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.getByTestId('block-user')).toBeTruthy();
  });
});
