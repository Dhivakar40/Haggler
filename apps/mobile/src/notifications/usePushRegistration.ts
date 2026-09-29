import { useEffect, useRef } from 'react';
import { registerPushToken } from '../api/endpoints';
import { getDeviceId } from '../auth/secure-storage';
import { registerForPushNotificationsAsync } from './push';

/**
 * Registers this device's push token with the API once signed in. Best-effort and silent: a
 * refusal (no permission, not a real device, Expo Go without a dev build) just means no push for
 * this session — the socket connection is the primary channel while the app is open (Phase 2), so
 * nothing else in the app depends on this succeeding.
 */
export function usePushRegistration(signedIn: boolean): void {
  const registered = useRef(false);
  useEffect(() => {
    if (!signedIn || registered.current) return;
    registered.current = true;
    void (async () => {
      const token = await registerForPushNotificationsAsync();
      if (!token) return;
      const deviceId = await getDeviceId();
      await registerPushToken({ deviceId, pushToken: token }).catch(() => undefined);
    })();
  }, [signedIn]);
}
