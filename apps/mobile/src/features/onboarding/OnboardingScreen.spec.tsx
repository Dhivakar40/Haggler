import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import i18n from '../../i18n';
import { useSession } from '../../auth/session';
import { useSettings } from '../../store/settings';
import { makeMe, mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { OnboardingScreen } from './OnboardingScreen';

const createdAddress = {
  id: '55555555-5555-4555-8555-555555555555',
  label: 'Home',
  line1: '12 Gandhi Road',
  line2: null,
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600042',
  isDefault: true,
  latitude: null,
  longitude: null,
};

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

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
const loc = Location as unknown as Record<string, jest.Mock>;

// `isDevice` is a plain boolean export copied by value into the module namespace at import time
// (see notifications/usePushRegistration.spec.ts), so it must be mocked here, not mutated later.
jest.mock('expo-device', () => ({ isDevice: true }));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  loc.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
  useSettings.setState({
    pushNotificationsEnabled: false,
    locationEnabled: false,
    preferredCategorySlugs: [],
  });
  signInAs({ profileComplete: false });
});

/** Advances through step 2 (Address) by skipping it, landing on step 3 (Preferences). */
async function skipToPreferences() {
  await fireEvent.press(await screen.findByTestId('onboarding-skip-address'));
  await screen.findByTestId('onboarding-finish');
}

/** Fills and advances step 1 (Profile) — every test needs this before step 2 is reachable. */
async function fillAndAdvanceStep1(over: { name?: string; email?: string; gender?: 'MALE' | 'FEMALE' } = {}) {
  await fireEvent.changeText(screen.getByTestId('onboarding-name'), over.name ?? 'Vikram Shah');
  if (over.email) await fireEvent.changeText(screen.getByTestId('email-input'), over.email);
  await fireEvent.changeText(screen.getByTestId('dob-day'), '04');
  await fireEvent.changeText(screen.getByTestId('dob-month'), '07');
  await fireEvent.changeText(screen.getByTestId('dob-year'), '1995');
  await fireEvent.press(screen.getByTestId(`gender-${over.gender ?? 'MALE'}`));
  await fireEvent.press(screen.getByTestId('onboarding-continue'));
}

describe('OnboardingScreen — step 1 (Profile)', () => {
  it('refuses to advance until name, date of birth and gender are all filled in', async () => {
    const { calls } = mockApi(() => undefined);
    await renderWithProviders(<OnboardingScreen />);
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    expect(await screen.findByText('Enter your full name.')).toBeTruthy();
    expect(screen.getByTestId('onboarding-name')).toBeTruthy(); // still on step 1
    expect(calls).toHaveLength(0);
  });

  it('rejects an impossible date of birth before ever advancing', async () => {
    mockApi(() => undefined);
    await renderWithProviders(<OnboardingScreen />);
    await fireEvent.changeText(screen.getByTestId('onboarding-name'), 'Asha Raman');
    await fireEvent.changeText(screen.getByTestId('dob-day'), '31');
    await fireEvent.changeText(screen.getByTestId('dob-month'), '02');
    await fireEvent.changeText(screen.getByTestId('dob-year'), '1995');
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    expect(await screen.findByText('Enter a valid date of birth.')).toBeTruthy();
  });

  it('(D-111) rejects a badly formatted email before ever advancing', async () => {
    const { calls } = mockApi(() => undefined);
    await renderWithProviders(<OnboardingScreen />);
    await fireEvent.changeText(screen.getByTestId('onboarding-name'), 'Vikram Shah');
    await fireEvent.changeText(screen.getByTestId('dob-day'), '04');
    await fireEvent.changeText(screen.getByTestId('dob-month'), '07');
    await fireEvent.changeText(screen.getByTestId('dob-year'), '1995');
    await fireEvent.press(screen.getByTestId('gender-MALE'));
    await fireEvent.changeText(screen.getByTestId('email-input'), 'not-an-email');
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('advancing to step 2 (Address) does not call the server — onboarding is one-time', async () => {
    const { calls } = mockApi(() => undefined);
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    expect(await screen.findByTestId('line1')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe('OnboardingScreen — step 2 (Address)', () => {
  it('back returns to step 1 with the entered values kept', async () => {
    mockApi(() => undefined);
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1({ name: 'Vikram Shah' });
    await fireEvent.press(await screen.findByTestId('onboarding-back'));
    expect(screen.getByTestId('onboarding-name').props.value).toBe('Vikram Shah');
  });

  it('"Skip" and "I\'ll add this later" both just advance to step 3 — nothing is submitted yet', async () => {
    const { calls } = mockApi((c) => (c.path === '/v1/categories' ? { body: categories } : undefined));
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await fireEvent.press(await screen.findByTestId('onboarding-skip-address'));
    expect(await screen.findByTestId('onboarding-finish')).toBeTruthy();
    expect(calls.some((c) => c.path === '/v1/me/onboarding' || c.path === '/v1/me/addresses')).toBe(
      false,
    );
  });

  it('a filled address advances to step 3 carrying the parsed address — nothing is submitted yet', async () => {
    const { calls } = mockApi((c) => (c.path === '/v1/categories' ? { body: categories } : undefined));
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await fireEvent.changeText(await screen.findByTestId('line1'), '12 Gandhi Road');
    await fireEvent.changeText(screen.getByTestId('city'), 'Chennai');
    await fireEvent.changeText(screen.getByTestId('state'), 'Tamil Nadu');
    await fireEvent.changeText(screen.getByTestId('pincode'), '600042');
    await fireEvent.press(screen.getByTestId('onboarding-continue-address'));
    expect(await screen.findByTestId('onboarding-finish')).toBeTruthy();
    expect(calls.some((c) => c.path === '/v1/me/onboarding' || c.path === '/v1/me/addresses')).toBe(
      false,
    );
  });

  it('validates the address before advancing (bad PIN code)', async () => {
    const { calls } = mockApi(() => undefined);
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await fireEvent.changeText(await screen.findByTestId('line1'), '12 Gandhi Road');
    await fireEvent.changeText(screen.getByTestId('city'), 'Chennai');
    await fireEvent.changeText(screen.getByTestId('state'), 'Tamil Nadu');
    await fireEvent.changeText(screen.getByTestId('pincode'), '6000');
    await fireEvent.press(screen.getByTestId('onboarding-continue-address'));
    expect(await screen.findByText('Please check the address details.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('"Use my current location" autofills city/state/PIN from GPS', async () => {
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    loc.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 12.9716, longitude: 80.2209 },
    });
    loc.reverseGeocodeAsync.mockResolvedValue([
      { city: 'Chennai', region: 'Tamil Nadu', postalCode: '600042' },
    ]);
    mockApi(() => undefined);
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await fireEvent.press(await screen.findByTestId('use-location'));
    expect(await screen.findByText('Location captured')).toBeTruthy();
    expect(screen.getByTestId('city').props.value).toBe('Chennai');
    expect(screen.getByTestId('pincode').props.value).toBe('600042');
  });
});

describe('OnboardingScreen — step 3 (Preferences)', () => {
  /** Gets from a blank screen to step 3 with a filled, valid address pending. */
  async function toStep3WithAddress() {
    await fillAndAdvanceStep1({ name: 'Asha Raman', gender: 'FEMALE', email: 'asha@example.com' });
    await fireEvent.changeText(await screen.findByTestId('line1'), '12 Gandhi Road');
    await fireEvent.changeText(screen.getByTestId('city'), 'Chennai');
    await fireEvent.changeText(screen.getByTestId('state'), 'Tamil Nadu');
    await fireEvent.changeText(screen.getByTestId('pincode'), '600042');
    await fireEvent.press(screen.getByTestId('onboarding-continue-address'));
    await screen.findByTestId('onboarding-finish');
  }

  it('back returns to step 2 with the address fields kept', async () => {
    mockApi((c) => (c.path === '/v1/categories' ? { body: categories } : undefined));
    await renderWithProviders(<OnboardingScreen />);
    await toStep3WithAddress();
    await fireEvent.press(screen.getByTestId('onboarding-back'));
    expect(screen.getByTestId('line1').props.value).toBe('12 Gandhi Road');
  });

  it('"Finish Setup" completes onboarding, then creates the pending address, with no email (D-111)', async () => {
    const completed = makeMe({ profileComplete: true });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/categories') return { body: categories };
      if (c.path === '/v1/me/onboarding') return { body: completed };
      if (c.path === '/v1/me') return { body: completed };
      if (c.path === '/v1/me/addresses' && c.method === 'POST')
        return { status: 201, body: createdAddress };
      return undefined;
    });
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1(); // no email passed
    await fireEvent.changeText(await screen.findByTestId('line1'), '12 Gandhi Road');
    await fireEvent.changeText(screen.getByTestId('city'), 'Chennai');
    await fireEvent.changeText(screen.getByTestId('state'), 'Tamil Nadu');
    await fireEvent.changeText(screen.getByTestId('pincode'), '600042');
    await fireEvent.press(screen.getByTestId('onboarding-continue-address'));
    await fireEvent.press(await screen.findByTestId('onboarding-finish'));

    await waitFor(() => expect(useSession.getState().user?.profileComplete).toBe(true));
    const onboardingIndex = calls.findIndex((c) => c.path === '/v1/me/onboarding');
    const addressIndex = calls.findIndex((c) => c.path === '/v1/me/addresses' && c.method === 'POST');
    expect(onboardingIndex).toBeGreaterThanOrEqual(0);
    expect(addressIndex).toBeGreaterThan(onboardingIndex); // onboarding completes first, see finish()
    expect(calls[onboardingIndex]?.body).toEqual({
      fullName: 'Vikram Shah',
      dateOfBirth: '1995-07-04',
      gender: 'MALE',
    });
    expect(calls[addressIndex]?.body).toEqual({
      label: 'Home',
      line1: '12 Gandhi Road',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600042',
    });
  });

  it('picking "Work" at step 2 carries through to the created address', async () => {
    const completed = makeMe({ profileComplete: true });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/categories') return { body: categories };
      if (c.path === '/v1/me/onboarding') return { body: completed };
      if (c.path === '/v1/me') return { body: completed };
      if (c.path === '/v1/me/addresses' && c.method === 'POST')
        return { status: 201, body: createdAddress };
      return undefined;
    });
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await fireEvent.changeText(await screen.findByTestId('line1'), '12 Gandhi Road');
    await fireEvent.changeText(screen.getByTestId('city'), 'Chennai');
    await fireEvent.changeText(screen.getByTestId('state'), 'Tamil Nadu');
    await fireEvent.changeText(screen.getByTestId('pincode'), '600042');
    await fireEvent.press(screen.getByTestId('address-label-Work'));
    await fireEvent.press(screen.getByTestId('onboarding-continue-address'));
    await fireEvent.press(await screen.findByTestId('onboarding-finish'));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/v1/me/addresses')?.body).toMatchObject({
        label: 'Work',
      }),
    );
  });

  it('"Skip" (top) finishes onboarding with no address, same as "Finish Setup" with nothing filled', async () => {
    const completed = makeMe({ profileComplete: true });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/categories') return { body: categories };
      if (c.path === '/v1/me/onboarding') return { body: completed };
      if (c.path === '/v1/me') return { body: completed };
      return undefined;
    });
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await skipToPreferences();
    await fireEvent.press(screen.getByTestId('onboarding-skip-preferences'));
    await waitFor(() => expect(useSession.getState().user?.profileComplete).toBe(true));
    expect(calls.some((c) => c.path === '/v1/me/addresses')).toBe(false);
  });

  it('real service categories are selectable, stored locally (not sent to the server)', async () => {
    const { calls } = mockApi((c) => (c.path === '/v1/categories' ? { body: categories } : undefined));
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await skipToPreferences();
    await fireEvent.press(await screen.findByTestId('preferred-category-electrician'));
    expect(useSettings.getState().preferredCategorySlugs).toEqual(['electrician']);
    await fireEvent.press(screen.getByTestId('preferred-category-plumber'));
    expect(useSettings.getState().preferredCategorySlugs).toEqual(['electrician', 'plumber']);
    await fireEvent.press(screen.getByTestId('preferred-category-electrician'));
    expect(useSettings.getState().preferredCategorySlugs).toEqual(['plumber']);
    expect(calls.every((c) => c.path !== '/v1/me/onboarding')).toBe(true); // selecting never submits
  });

  it('(D-113) push permission is never requested until the toggle is switched on', async () => {
    const Notifications = jest.requireMock('expo-notifications') as Record<string, jest.Mock>;
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockApi((c) =>
      c.path === '/v1/categories' ? { body: categories } : { status: 200, body: { ok: true } },
    );
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await skipToPreferences();
    expect(screen.getByTestId('onboarding-push-toggle').props.accessibilityState.checked).toBe(
      false,
    );
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('onboarding-push-toggle'));
    expect(useSettings.getState().pushNotificationsEnabled).toBe(true);
    await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());
  });

  it('(D-113) location permission is never requested until the toggle is switched on', async () => {
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockApi((c) => (c.path === '/v1/categories' ? { body: categories } : undefined));
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await skipToPreferences();
    expect(screen.getByTestId('onboarding-location-toggle').props.accessibilityState.checked).toBe(
      false,
    );
    expect(loc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('onboarding-location-toggle'));
    expect(useSettings.getState().locationEnabled).toBe(true);
    await waitFor(() => expect(loc.requestForegroundPermissionsAsync).toHaveBeenCalled());
  });

  it('shows the server error and does not advance into the app when onboarding fails for real', async () => {
    mockApi((c) => {
      if (c.path === '/v1/categories') return { body: categories };
      if (c.path === '/v1/me/onboarding')
        return { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } };
      return undefined;
    });
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await skipToPreferences();
    await fireEvent.press(screen.getByTestId('onboarding-skip-preferences'));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(useSession.getState().user?.profileComplete).toBe(false);
  });

  it('treats "already completed" (409) as success rather than an error — a stranded retry recovers', async () => {
    const completed = makeMe({ profileComplete: true });
    mockApi((c) => {
      if (c.path === '/v1/categories') return { body: categories };
      if (c.path === '/v1/me/onboarding')
        return { status: 409, body: { error: { code: 'CONFLICT', message: 'Already done.' } } };
      if (c.path === '/v1/me') return { body: completed };
      return undefined;
    });
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await skipToPreferences();
    await fireEvent.press(screen.getByTestId('onboarding-skip-preferences'));
    await waitFor(() => expect(useSession.getState().user?.profileComplete).toBe(true));
  });
});
