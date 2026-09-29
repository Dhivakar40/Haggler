/**
 * `expo-device`'s `isDevice` is a plain boolean export, not a function — mutating it on an
 * `import * as Device` namespace object after the fact does not reach modules that already
 * imported it (each import gets its own interop-wrapped snapshot). So each test loads a fresh
 * module graph (`jest.resetModules` + `jest.doMock`) with the `isDevice` value it needs, and reads
 * back the `expo-notifications` mock from THAT graph (resetModules also throws away the previous
 * graph's mock instances) rather than the one imported at this file's top level.
 */
function load(isDevice: boolean): {
  register: () => Promise<string | null>;
  notif: Record<string, jest.Mock>;
} {
  jest.resetModules();
  jest.doMock('expo-device', () => ({ isDevice }));
  // Needs the fresh module graph created by resetModules()/doMock() above, not a statically
  // hoisted import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const notif = require('expo-notifications') as Record<string, jest.Mock>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same reason
  const push = require('./push') as {
    registerForPushNotificationsAsync: () => Promise<string | null>;
  };
  return { register: push.registerForPushNotificationsAsync, notif };
}

describe('registerForPushNotificationsAsync', () => {
  it('returns null on a simulator/emulator without asking for permission', async () => {
    const { register, notif } = load(false);
    const token = await register();
    expect(token).toBeNull();
    expect(notif.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns null when permission is refused', async () => {
    const { register, notif } = load(true);
    notif.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    notif.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const token = await register();
    expect(token).toBeNull();
    expect(notif.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });

  it('does not re-prompt when permission was already granted', async () => {
    const { register, notif } = load(true);
    notif.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    notif.getDevicePushTokenAsync.mockResolvedValue({ data: 'raw-fcm-token' });
    const token = await register();
    expect(token).toBe('raw-fcm-token');
    expect(notif.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns the raw device token once granted', async () => {
    const { register, notif } = load(true);
    notif.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    notif.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    notif.getDevicePushTokenAsync.mockResolvedValue({ data: 'raw-fcm-token' });
    const token = await register();
    expect(token).toBe('raw-fcm-token');
  });

  it('returns null (not a thrown error) when the platform push service is unreachable', async () => {
    const { register, notif } = load(true);
    notif.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    notif.getDevicePushTokenAsync.mockRejectedValue(new Error('no Google Play services'));
    await expect(register()).resolves.toBeNull();
  });
});
