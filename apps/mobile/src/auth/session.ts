import { Platform } from 'react-native';
import { create } from 'zustand';
import { type AuthSession, type Me, meSchema, tokenPairSchema } from '@haggler/shared';
import { ApiError, apiRequest, configureAuth } from '../api/client';
import { clearRefreshToken, getDeviceId, getRefreshToken, setRefreshToken } from './secure-storage';

interface SessionState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: Me | null;
  /** In memory only. The refresh token (in the keystore) is what survives an app restart. */
  accessToken: string | null;
  bootstrap: () => Promise<void>;
  startSession: (s: AuthSession) => Promise<void>;
  refreshMe: () => Promise<Me | null>;
  signOut: () => Promise<void>;
}

let refreshInFlight: Promise<boolean> | null = null;
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * "Keep me logged in" (D-075) means the person should rarely, if ever, see the reactive 401 ->
 * refresh round trip `apiRequest` already does. So in addition to that safety net, proactively
 * refresh a bit before the access token actually expires (70% of its life), while signed in.
 */
function scheduleProactiveRefresh(expiresInSeconds: number): void {
  if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer);
  const delayMs = Math.max(10_000, expiresInSeconds * 0.7 * 1000);
  proactiveRefreshTimer = setTimeout(() => {
    if (useSession.getState().status === 'signedIn') void doRefresh().catch(() => undefined);
  }, delayMs);
  // Node's timer (not React Native's, which has no unref) would otherwise keep the test runner's
  // process alive until this fires.
  (proactiveRefreshTimer as unknown as { unref?: () => void }).unref?.();
}

export const useSession = create<SessionState>()((set, get) => ({
  status: 'loading',
  user: null,
  accessToken: null,

  /** App start: if a refresh token exists, turn it into a session. */
  async bootstrap() {
    const token = await getRefreshToken();
    if (!token) return set({ status: 'signedOut' });
    try {
      if (!(await doRefresh())) return set({ status: 'signedOut' });
      const me = await apiRequest('/v1/me', { schema: meSchema });
      set({ user: me, status: 'signedIn' });
    } catch {
      // Offline or server down: keep the refresh token so the next launch can still recover.
      set({ status: 'signedOut', accessToken: null });
    }
  },

  async startSession(s) {
    await setRefreshToken(s.refreshToken);
    set({ accessToken: s.accessToken, user: s.user, status: 'signedIn' });
    scheduleProactiveRefresh(s.expiresInSeconds);
  },

  async refreshMe() {
    try {
      const me = await apiRequest('/v1/me', { schema: meSchema });
      set({ user: me });
      return me;
    } catch {
      return get().user;
    }
  },

  async signOut() {
    const token = await getRefreshToken();
    // Tell the server (best effort), then forget everything locally regardless.
    if (token)
      await apiRequest('/v1/auth/logout', {
        method: 'POST',
        body: { refreshToken: token },
        auth: false,
      }).catch(() => undefined);
    await clearRefreshToken();
    if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer);
    set({ user: null, accessToken: null, status: 'signedOut' });
  },
}));

/**
 * Exchange the stored refresh token for a new pair. Single-flight: concurrent callers share one
 * network call. Returns false if the server says the session is over; throws if we are offline
 * (so a flaky network never signs the user out).
 */
export function doRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return false;
    try {
      const pair = await apiRequest('/v1/auth/refresh', {
        method: 'POST',
        auth: false,
        body: { refreshToken, deviceId: await getDeviceId() },
        schema: tokenPairSchema,
      });
      await setRefreshToken(pair.refreshToken); // the old one is now dead: persist the new one first
      useSession.setState({ accessToken: pair.accessToken });
      scheduleProactiveRefresh(pair.expiresInSeconds);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await clearRefreshToken();
        return false;
      }
      throw err;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

configureAuth({
  getAccessToken: () => useSession.getState().accessToken,
  refresh: () => doRefresh().catch(() => false),
  onSessionEnded: () => {
    useSession.setState({ user: null, accessToken: null, status: 'signedOut' });
  },
});

export const devicePlatform = (): 'android' | 'ios' | 'web' =>
  Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web';
