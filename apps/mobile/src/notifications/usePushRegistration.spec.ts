import * as Notifications from 'expo-notifications';
import { renderHook } from '@testing-library/react-native';
import { mockApi } from '../test-utils';
import { usePushRegistration } from './usePushRegistration';

// See push.spec.ts: expo-device's `isDevice` is a plain boolean export, so it must be mocked
// before this module (and its transitive `./push` import) first loads, not mutated afterwards.
// jest.mock is hoisted above the imports above, so this applies in time.
jest.mock('expo-device', () => ({ isDevice: true }));

const notif = Notifications as unknown as Record<string, jest.Mock>;

describe('usePushRegistration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    notif.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    notif.getDevicePushTokenAsync.mockResolvedValue({ data: 'raw-fcm-token' });
  });

  it('does nothing while signed out', async () => {
    const { calls } = mockApi(() => ({ status: 200, body: { ok: true } }));
    renderHook(() => usePushRegistration(false));
    await Promise.resolve();
    expect(calls).toHaveLength(0);
  });

  it('registers the device token with the API once signed in', async () => {
    const { calls } = mockApi((c) =>
      c.method === 'PATCH' && c.path === '/v1/me/push-token'
        ? { status: 200, body: { ok: true } }
        : undefined,
    );
    renderHook(() => usePushRegistration(true));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      deviceId: 'test-device-uuid-0001',
      pushToken: 'raw-fcm-token',
    });
  });

  it('never registers twice for the same mounted session', async () => {
    const { calls } = mockApi(() => ({ status: 200, body: { ok: true } }));
    const { rerender } = await renderHook(
      ({ signedIn }: { signedIn: boolean }) => usePushRegistration(signedIn),
      { initialProps: { signedIn: true } },
    );
    await rerender({ signedIn: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
  });

  it('silently does nothing when no push token could be obtained', async () => {
    notif.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const { calls } = mockApi(() => ({ status: 200, body: { ok: true } }));
    renderHook(() => usePushRegistration(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(0);
  });
});
