import { z } from 'zod';
import { ApiError, apiRequest } from '../api/client';
import { makeMe, mockApi, secureStore } from '../test-utils';
import { doRefresh, useSession } from './session';

const pair = (n: number) => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-token-number-${n}-xxxxxxxx`,
  expiresInSeconds: 900,
});

beforeEach(() => {
  secureStore().clear();
  useSession.setState({ status: 'loading', user: null, accessToken: null });
});

describe('doRefresh (single-flight)', () => {
  it('many concurrent callers share ONE network call (refresh tokens are single-use)', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    const { calls } = mockApi((c) =>
      c.path === '/v1/auth/refresh' ? { body: pair(1) } : undefined,
    );
    const results = await Promise.all([doRefresh(), doRefresh(), doRefresh(), doRefresh()]);
    expect(results).toEqual([true, true, true, true]);
    expect(calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(1);
  });

  it('persists the NEW refresh token and sends the device id', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    const { calls } = mockApi(() => ({ body: pair(1) }));
    await doRefresh();
    expect(secureStore().get('haggler.refresh')).toBe(pair(1).refreshToken);
    expect(useSession.getState().accessToken).toBe('access-1');
    expect(calls[0]?.body).toEqual({
      refreshToken: 'refresh-token-number-0-xxxxxxxx',
      deviceId: 'test-device-uuid-0001',
    });
  });

  it('a 401 from the server ends the session and clears the stored token', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    mockApi(() => ({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }));
    expect(await doRefresh()).toBe(false);
    expect(secureStore().has('haggler.refresh')).toBe(false);
  });

  it('being offline throws and KEEPS the token (a flaky network must not sign anyone out)', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Network request failed'));
    await expect(doRefresh()).rejects.toBeInstanceOf(TypeError);
    expect(secureStore().get('haggler.refresh')).toBe('refresh-token-number-0-xxxxxxxx');
  });

  it('returns false when there is no token at all', async () => {
    expect(await doRefresh()).toBe(false);
  });
});

describe('automatic refresh on 401', () => {
  it('refreshes once, replays the request with the new token, and succeeds', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    useSession.setState({ status: 'signedIn', accessToken: 'expired-token' });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/auth/refresh') return { body: pair(1) };
      if (c.path === '/v1/thing') {
        return c.headers.Authorization === 'Bearer access-1'
          ? { body: { ok: true } }
          : { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'expired' } } };
      }
    });
    await expect(
      apiRequest('/v1/thing', { schema: z.object({ ok: z.boolean() }) }),
    ).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.path)).toEqual(['/v1/thing', '/v1/auth/refresh', '/v1/thing']);
  });

  it('ten parallel requests that all get 401 cause exactly one refresh', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    useSession.setState({ status: 'signedIn', accessToken: 'expired-token' });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/auth/refresh') return { body: pair(1) };
      return c.headers.Authorization === 'Bearer access-1'
        ? { body: { ok: true } }
        : { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'expired' } } };
    });
    const schema = z.object({ ok: z.boolean() });
    await Promise.all(Array.from({ length: 10 }, () => apiRequest('/v1/thing', { schema })));
    expect(calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(1);
  });

  it('if the refresh fails the user is signed out and the original error surfaces', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    useSession.setState({ status: 'signedIn', user: makeMe(), accessToken: 'expired-token' });
    mockApi(() => ({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'nope' } },
    }));
    await expect(apiRequest('/v1/thing')).rejects.toBeInstanceOf(ApiError);
    expect(useSession.getState()).toMatchObject({
      status: 'signedOut',
      user: null,
      accessToken: null,
    });
  });
});

describe('session lifecycle', () => {
  it('bootstrap with no stored token -> signed out', async () => {
    await useSession.getState().bootstrap();
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('bootstrap with a valid stored token -> refreshes and loads the user', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    mockApi((c) =>
      c.path === '/v1/auth/refresh'
        ? { body: pair(1) }
        : c.path === '/v1/me'
          ? { body: makeMe({ fullName: 'Ravi' }) }
          : undefined,
    );
    await useSession.getState().bootstrap();
    expect(useSession.getState()).toMatchObject({ status: 'signedIn', accessToken: 'access-1' });
    expect(useSession.getState().user?.fullName).toBe('Ravi');
  });

  it('bootstrap with a revoked token -> signed out', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    mockApi(() => ({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }));
    await useSession.getState().bootstrap();
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('bootstrap while offline -> signed out but the token is kept for next launch', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('offline'));
    await useSession.getState().bootstrap();
    expect(useSession.getState().status).toBe('signedOut');
    expect(secureStore().has('haggler.refresh')).toBe(true);
  });

  it('startSession stores the refresh token in the keystore and the access token only in memory', async () => {
    await useSession.getState().startSession({ ...pair(1), isNewUser: true, user: makeMe() });
    expect(secureStore().get('haggler.refresh')).toBe(pair(1).refreshToken);
    expect([...secureStore().values()]).not.toContain('access-1');
    expect(useSession.getState().status).toBe('signedIn');
  });

  it('signOut tells the server, forgets the token, and clears the user', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    useSession.setState({ status: 'signedIn', user: makeMe(), accessToken: 'a' });
    const { calls } = mockApi(() => ({ status: 204 }));
    await useSession.getState().signOut();
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/auth/logout',
      body: { refreshToken: 'refresh-token-number-0-xxxxxxxx' },
    });
    expect(secureStore().has('haggler.refresh')).toBe(false);
    expect(useSession.getState()).toMatchObject({
      status: 'signedOut',
      user: null,
      accessToken: null,
    });
  });

  it('signOut still succeeds locally when the server is unreachable', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('offline'));
    await useSession.getState().signOut();
    expect(secureStore().has('haggler.refresh')).toBe(false);
    expect(useSession.getState().status).toBe('signedOut');
  });
});
