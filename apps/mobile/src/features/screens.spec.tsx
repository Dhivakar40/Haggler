import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../i18n';
import { useSettings } from '../store/settings';
import { mockFetchOnce, renderWithProviders } from '../test-utils';
import { HomeScreen } from './home/HomeScreen';
import { SettingsScreen } from './settings/SettingsScreen';

const categories = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'electrician',
    nameKey: 'categories.electrician',
    icon: 'flash',
    requiresLicense: false,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'plumber',
    nameKey: 'categories.plumber',
    icon: 'water',
    requiresLicense: false,
  },
];

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useSettings.setState({ themeMode: 'system', language: null });
});

describe('HomeScreen', () => {
  it('shows the real categories returned by the API, translated', async () => {
    mockFetchOnce({ '/v1/categories': { body: categories } });
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText('Electrician')).toBeTruthy();
    expect(screen.getByText('Plumber')).toBeTruthy();
    expect(screen.getByText('Verified Rangers near you')).toBeTruthy();
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
});

describe('SettingsScreen', () => {
  const ready = {
    status: 'degraded',
    checks: { postgres: 'up', redis: 'down' },
    adapters: {
      sms: 'sandbox',
      kyc: 'sandbox',
      payments: 'live',
      calls: 'sandbox',
      push: 'sandbox',
      maps: 'sandbox',
    },
  };

  it('saves the chosen theme and language to the settings store', async () => {
    mockFetchOnce({ '/health/ready': { body: ready } });
    await renderWithProviders(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('theme-dark'));
    expect(useSettings.getState().themeMode).toBe('dark');
    await fireEvent.press(screen.getByTestId('lang-ta'));
    expect(useSettings.getState().language).toBe('ta');
  });

  it('is honest about degraded services and which adapters are live vs test mode', async () => {
    mockFetchOnce({ '/health/ready': { body: ready } });
    await renderWithProviders(<SettingsScreen />);
    await waitFor(() => expect(screen.getByTestId('server-status')).toBeTruthy());
    expect(screen.getByText('Connected (some services degraded)')).toBeTruthy();
    expect(screen.getByText('Payments: live')).toBeTruthy();
    expect(screen.getByText('SMS: test mode')).toBeTruthy();
  });

  it('says so when the server is unreachable', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockRejectedValue(new Error('offline'));
    await renderWithProviders(<SettingsScreen />);
    expect(await screen.findByText('Cannot reach the server')).toBeTruthy();
  });
});
