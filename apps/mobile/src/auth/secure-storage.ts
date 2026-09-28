import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/** Refresh token and device id live in the OS keystore (Android Keystore / iOS Keychain). */
const REFRESH_KEY = 'haggler.refresh';
const DEVICE_KEY = 'haggler.device';

export const getRefreshToken = () => SecureStore.getItemAsync(REFRESH_KEY);
export const setRefreshToken = (v: string) => SecureStore.setItemAsync(REFRESH_KEY, v);
export const clearRefreshToken = () => SecureStore.deleteItemAsync(REFRESH_KEY);

/**
 * A stable random id for this install. The server binds refresh tokens to it, so a token stolen
 * from another phone is useless. It is not a hardware id and reveals nothing about the device.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const fresh = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_KEY, fresh);
  return fresh;
}
