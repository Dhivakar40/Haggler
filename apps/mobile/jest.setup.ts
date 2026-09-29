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

// Navigation is exercised through a shared spy router.
jest.mock('expo-router', () => {
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
  return {
    __router: router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
  };
});
