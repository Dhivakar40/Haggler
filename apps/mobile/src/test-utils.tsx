import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import type { JobDto, Me, OfferDto } from '@haggler/shared';
import '../src/i18n';
import { useSession } from './auth/session';
import { ThemeProvider } from './theme/ThemeProvider';

/** Renders with the same providers the real app uses (theme, i18n, react-query). */
export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

export function mockFetchOnce(routes: Record<string, { status?: number; body: unknown }>) {
  const fn = jest.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const hit = routes[path];
    if (!hit) throw new Error(`unmocked fetch ${path}`);
    return {
      ok: (hit.status ?? 200) < 400,
      status: hit.status ?? 200,
      text: async () => JSON.stringify(hit.body),
    };
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

export interface MockCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}
export type Handler = (
  call: MockCall,
) => { status?: number; body?: unknown; blobSize?: number } | undefined;

/**
 * Replaces fetch with a handler that sees method, path, JSON body and headers. Returning
 * undefined fails the test loudly (an unexpected request is a bug). `calls` records everything.
 */
export function mockApi(handler: Handler) {
  const calls: MockCall[] = [];
  const fn = jest.fn(
    async (
      url: string,
      init?: { method?: string; body?: unknown; headers?: Record<string, string> },
    ) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const call: MockCall = {
        method: init?.method ?? 'GET',
        path,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
        headers: init?.headers ?? {},
      };
      calls.push(call);
      const res = handler(call);
      if (!res) throw new Error(`unhandled request ${call.method} ${path}`);
      const status = res.status ?? 200;
      return {
        ok: status < 400,
        status,
        text: async () => (res.body === undefined ? '' : JSON.stringify(res.body)),
        blob: async () => ({ size: res.blobSize ?? 0 }),
      };
    },
  );
  (global as unknown as { fetch: unknown }).fetch = fn;
  return { fn, calls };
}

export const makeMe = (over: Partial<Me> = {}): Me => ({
  id: '11111111-1111-4111-8111-111111111111',
  phone: '+919876543210',
  fullName: 'Asha Raman',
  photoUrl: null,
  email: null,
  dateOfBirth: null,
  gender: null,
  profileComplete: true,
  preferredLanguage: 'en',
  languages: ['en'],
  roles: ['CUSTOMER'],
  status: 'ACTIVE',
  missingConsents: [],
  workerKycTier: null,
  ...over,
});

export function signInAs(over: Partial<Me> = {}) {
  useSession.setState({ status: 'signedIn', user: makeMe(over), accessToken: 'access-token-1' });
}

export const routerMock = (): { push: jest.Mock; replace: jest.Mock; back: jest.Mock } =>
  (
    jest.requireMock('expo-router') as {
      __router: { push: jest.Mock; replace: jest.Mock; back: jest.Mock };
    }
  ).__router;

export const secureStore = (): Map<string, string> =>
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store;

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
export { iso };

/** A complete JobDto as the server would send it. Override only what a test cares about. */
export const makeJob = (over: Partial<JobDto> = {}): JobDto => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  viewerRole: 'CUSTOMER',
  status: 'BROADCASTING',
  categorySlug: 'electrician',
  description: 'Ceiling fan is not working',
  urgency: 'IMMEDIATE',
  scheduledFor: null,
  city: 'Chennai',
  pincode: '600042',
  addressLine: '12 Gandhi Road, Chennai, Tamil Nadu, 600042',
  location: { latitude: 13.0827, longitude: 80.2707 },
  band: { scope: 'DEFAULT', minPaise: 19900, medianPaise: 34900, maxPaise: 69900 },
  agreedPricePaise: null,
  genderPreference: 'ANY',
  genderPreferenceMet: null,
  isRush: false,
  broadcast: { wave: 1, deadline: iso(180_000), slaEstimateMinutes: 4 },
  customer: { id: '11111111-1111-4111-8111-111111111111', firstName: 'Asha' },
  worker: null,
  review: { canReview: false, submitted: false },
  offers: [],
  arrivalCode: null,
  arrivalVerified: false,
  hasBeforePhoto: false,
  hasAfterPhoto: false,
  paymentMethod: null,
  cancellation: null,
  media: [],
  threadId: null,
  createdAt: iso(-60_000),
  ...over,
});

export const rangerParty = {
  id: '22222222-2222-4222-8222-222222222222',
  firstName: 'Ravi',
  kycTier: 2,
  league: 'SILVER',
  jobsCompleted: 12,
  ratingAvg: 4.6,
  ratingCount: 9,
};

export const offer = (over: Partial<OfferDto> = {}): OfferDto => ({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  round: 1,
  fromRole: 'WORKER',
  amountPaise: 50000,
  outsideBand: false,
  status: 'PENDING',
  expiresAt: iso(240_000),
  ...over,
});
