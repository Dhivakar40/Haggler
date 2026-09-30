import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
// Type-only: erased at compile time, so this does not trigger the runtime side effect below.
import type * as NotificationsModule from 'expo-notifications';

/**
 * `expo-notifications` must NOT be statically imported: merely importing it runs a module-level
 * side effect (DevicePushTokenAutoRegistration) that, on Android in Expo Go (SDK 53+), THROWS —
 * not warns — crashing the whole app before _layout.tsx even finishes evaluating (its `export
 * default` never gets reached). A `require()` called lazily inside a function body (not at module
 * top level) is not hoisted, so it only runs when actually reached — unlike `import()`, this also
 * works under Jest without `--experimental-vm-modules`. Loading it only when needed and only
 * outside Expo Go keeps Expo Go usable for everything else while push still works in a real
 * dev/production build. See https://docs.expo.dev/develop/development-builds/introduction/.
 */
function loadNotifications(): typeof NotificationsModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay lazy, see above
  return require('expo-notifications') as typeof NotificationsModule;
}

/**
 * Foreground behaviour: still show an alert/sound even while the app is open. Call once at app
 * start (see _layout.tsx), same pattern as `defineBackgroundTask` for location. A no-op in Expo Go.
 */
export function configureNotificationHandler(): void {
  if (isRunningInExpoGo()) return;
  loadNotifications().setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Asks for permission and returns this device's RAW platform push token (the FCM registration id
 * on Android, the APNs device token on iOS) — not an Expo push token. The API's live adapter talks
 * to FCM directly with firebase-admin (see docs/DECISIONS.md D-051), so it needs the raw token, and
 * this deliberately skips Expo's own hosted push relay (which would need a different token shape
 * and a separate Expo access-token dependency). Returns null if permission was refused, this is a
 * simulator (no real push service), Expo Go (push was removed from Expo Go in SDK 53), or the
 * platform push service could not be reached — the caller should treat null as "no push for this
 * session", not an error: the socket connection still covers a foregrounded/recently-backgrounded
 * app (Phase 2), this only adds reach when it doesn't.
 *
 * iOS is not fully wired yet (D-051): an APNs device token needs to be registered with FCM's APNs
 * bridge (or sent to APNs directly) before it is usable, which `FcmPushProvider` does not do.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (isRunningInExpoGo()) return null; // removed from Expo Go entirely in SDK 53+
  if (!Device.isDevice) return null; // simulators/emulators have no push service
  const Notifications = loadNotifications();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;
  try {
    const { data } = await Notifications.getDevicePushTokenAsync();
    return typeof data === 'string' ? data : null;
  } catch {
    // No Google Play services / APNs unreachable / not a real build — not fatal.
    return null;
  }
}
