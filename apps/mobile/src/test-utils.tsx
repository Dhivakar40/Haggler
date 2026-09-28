import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import type { Me } from '@haggler/shared';
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
