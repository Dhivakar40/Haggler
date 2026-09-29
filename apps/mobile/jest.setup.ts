jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Native keystore: an in-memory stand-in so session logic can be tested for real.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'test-device-uuid-0001') }));

// Push notifications: default to "no device, no permission" so tests that don't care about push
// (almost all of them) never try to touch a real notification service. Tests that DO care mock
// these modules themselves with a narrower, test-local jest.mock.
jest.mock('expo-device', () => ({ isDevice: false }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: 'test-push-token' })),
  AndroidImportance: { DEFAULT: 3 },
}));

// Navigation is exercised through a shared spy router.
jest.mock('expo-router', () => {
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
  return {
    __router: router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
  };
});
