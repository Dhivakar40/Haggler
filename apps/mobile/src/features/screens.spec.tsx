import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../i18n';
import { useSettings } from '../store/settings';
import { ToastHost } from '../components';
import { mockApi, mockFetchOnce, renderWithProviders, routerMock, signInAs } from '../test-utils';
import { AllCategoriesScreen } from './home/AllCategoriesScreen';
import { HomeScreen } from './home/HomeScreen';
import { SettingsScreen } from './settings/SettingsScreen';

// `isDevice` is a plain boolean export copied by value into the module namespace at import time
// (see notifications/usePushRegistration.spec.ts), so it must be mocked here, not mutated later,
// for the Settings "re-enable push" test below to see a real device.
jest.mock('expo-device', () => ({ isDevice: true }));

const categories = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'electrician',
    nameKey: 'categories.electrician',
    icon: 'flash',
    requiresLicense: false,
    inspectionChargePaise: null,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'plumber',
    nameKey: 'categories.plumber',
    icon: 'water',
    requiresLicense: false,
    inspectionChargePaise: null,
  },
];

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useSettings.setState({
    themeMode: 'system',
    language: null,
    pushNotificationsEnabled: false,
    locationEnabled: false,
    preferredCategorySlugs: [],
  });
});

describe('HomeScreen', () => {
  it('shows the real categories returned by the API, translated', async () => {
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText('Electrician')).toBeTruthy();
    expect(screen.getByText('Plumber')).toBeTruthy();
    expect(screen.getByText('Verified Rangers near you')).toBeTruthy();
  });

  it('(D-104) greets a signed-in user by their first name', async () => {
    signInAs({ fullName: 'Asha Raman' });
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText('Hi Asha, what do you need help with?')).toBeTruthy();
  });

  it('(D-104) falls back to the plain greeting when no name is on file', async () => {
    signInAs({ fullName: null });
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText('What do you need help with?')).toBeTruthy();
  });

  it('shows a skeleton while loading, gone once the categories arrive', async () => {
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await renderWithProviders(<HomeScreen />);
    expect(screen.getByTestId('home-skeleton')).toBeTruthy();
    await screen.findByText('Electrician');
    expect(screen.queryByTestId('home-skeleton')).toBeNull();
  });

  it('falls back to a safe icon when the server sends one Ionicons does not have', async () => {
    mockFetchOnce({
      '/v1/categories': {
        body: [{ ...categories[0], icon: 'not-a-real-icon-name' }],
      },
    });
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText('Electrician')).toBeTruthy();
    expect(screen.getByTestId('category-electrician')).toBeTruthy();
  });

  it('re-renders in Hindi when the language changes', async () => {
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await renderWithProviders(<HomeScreen />);
    await screen.findByText('Electrician');
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(await screen.findByText('इलेक्ट्रीशियन')).toBeTruthy();
    expect(screen.getByText('आपके पास सत्यापित रेंजर')).toBeTruthy();
  });

  it('shows an error with retry when the API fails, then recovers', async () => {
    mockFetchOnce({
      '/v1/categories': { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } },
    });
    await renderWithProviders(<HomeScreen />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await fireEvent.press(retry);
    expect(await screen.findByText('Electrician')).toBeTruthy();
  });

  it('shows the empty state for an empty catalog', async () => {
    mockFetchOnce({ '/v1/categories': { body: [] } });
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText('Nothing here yet.')).toBeTruthy();
  });

  it('(D-114) searching filters both categories and popular services by name', async () => {
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await renderWithProviders(<HomeScreen />);
    await screen.findByText('Electrician');
    expect(screen.getByText('Room Cleaning')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('home-search'), 'clean');
    expect(screen.queryByText('Electrician')).toBeNull();
    expect(screen.getByText('Room Cleaning')).toBeTruthy();
  });

  it('(D-114) "See All" opens the full category list', async () => {
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await renderWithProviders(<HomeScreen />);
    await screen.findByText('Electrician');
    await fireEvent.press(screen.getByTestId('home-see-all-categories'));
    expect(routerMock().push).toHaveBeenCalledWith('/categories');
  });

  it('(D-114) the notification bell opens Settings (no in-app inbox exists)', async () => {
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await renderWithProviders(<HomeScreen />);
    await screen.findByText('Electrician');
    await fireEvent.press(screen.getByTestId('home-notifications'));
    expect(routerMock().push).toHaveBeenCalledWith('/settings');
  });

  it('(D-114) a popular-service card opens a real request for its real category; the heart is a local-only toggle', async () => {
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await renderWithProviders(<HomeScreen />);
    const card = await screen.findByTestId('popular-service-mock-ac-installation');
    expect(card).toBeTruthy();

    const like = screen.getByTestId('popular-like-mock-ac-installation');
    expect(like.props.accessibilityState.selected).toBe(false);
    await fireEvent.press(like);
    expect(like.props.accessibilityState.selected).toBe(true);

    await fireEvent.press(card);
    expect(routerMock().push).toHaveBeenCalledWith({
      pathname: '/request/new',
      params: { category: 'ac_repair' },
    });
  });
});

describe('SettingsScreen', () => {
  it('saves the chosen theme and language to the settings store', async () => {
    await renderWithProviders(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('theme-dark'));
    expect(useSettings.getState().themeMode).toBe('dark');
    await fireEvent.press(screen.getByTestId('lang-ta'));
    expect(useSettings.getState().language).toBe('ta');
  });

  it('(D-113) starts off by default; turning push notifications on registers this device, off unregisters it', async () => {
    const Notifications = jest.requireMock('expo-notifications') as Record<string, jest.Mock>;
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const { calls } = mockApi(() => ({ status: 200, body: { ok: true } }));
    await renderWithProviders(<SettingsScreen />);
    const toggle = screen.getByTestId('push-notifications-toggle');
    expect(toggle.props.accessibilityState.checked).toBe(false);

    await fireEvent.press(toggle);
    expect(useSettings.getState().pushNotificationsEnabled).toBe(true);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH' && c.path === '/v1/me/push-token')).toBe(
        true,
      ),
    );

    await fireEvent.press(toggle);
    expect(useSettings.getState().pushNotificationsEnabled).toBe(false);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/v1/me/push-token')).toBe(
        true,
      ),
    );
  });

  it('clearing the cache shows a confirmation toast', async () => {
    mockApi(() => ({ status: 200, body: { ok: true } }));
    await renderWithProviders(
      <>
        <SettingsScreen />
        <ToastHost />
      </>,
    );
    await fireEvent.press(screen.getByTestId('clear-cache'));
    expect(await screen.findByText('Cache cleared.')).toBeTruthy();
  });
});

describe('AllCategoriesScreen (D-114, Home "See All")', () => {
  it('shows every real category, unlimited', async () => {
    const many = [...categories, { ...categories[0], id: '99999999-9999-4999-8999-999999999999', slug: 'cleaner2', nameKey: 'categories.cleaner' }];
    mockFetchOnce({ '/v1/categories': { body: many } });
    await renderWithProviders(<AllCategoriesScreen />);
    expect(await screen.findByText('Electrician')).toBeTruthy();
    expect(screen.getByTestId('category-electrician')).toBeTruthy();
    expect(screen.getByTestId('category-plumber')).toBeTruthy();
    expect(screen.getByTestId('category-cleaner2')).toBeTruthy();
  });

  it('shows an error with retry when the API fails', async () => {
    mockFetchOnce({
      '/v1/categories': { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } },
    });
    await renderWithProviders(<AllCategoriesScreen />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
