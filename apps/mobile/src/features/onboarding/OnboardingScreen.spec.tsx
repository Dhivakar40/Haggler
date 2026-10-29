import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import i18n from '../../i18n';
import { useSession } from '../../auth/session';
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

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
const loc = Location as unknown as Record<string, jest.Mock>;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ profileComplete: false });
});

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

  it('"Skip" finishes onboarding with no address and no email', async () => {
    const completed = makeMe({ fullName: 'Vikram Shah', profileComplete: true });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/me/onboarding') return { body: completed };
      if (c.path === '/v1/me') return { body: completed };
      return undefined;
    });
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await fireEvent.press(await screen.findByTestId('onboarding-skip-address'));
    await waitFor(() => expect(useSession.getState().user?.profileComplete).toBe(true));
    expect(calls.find((c) => c.path === '/v1/me/onboarding')?.body).toEqual({
      fullName: 'Vikram Shah',
      dateOfBirth: '1995-07-04',
      gender: 'MALE',
    });
    expect(calls.some((c) => c.path === '/v1/me/addresses')).toBe(false);
  });

  it('"I\'ll add this later" (bottom) does the same as "Skip" (top)', async () => {
    const completed = makeMe({ profileComplete: true });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/me/onboarding') return { body: completed };
      if (c.path === '/v1/me') return { body: completed };
      return undefined;
    });
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await fireEvent.press(await screen.findByTestId('onboarding-skip-address-later'));
    await waitFor(() => expect(useSession.getState().user?.profileComplete).toBe(true));
    expect(calls.some((c) => c.path === '/v1/me/addresses')).toBe(false);
  });

  it('Continue with a filled address creates it (default "Home" label) after completing onboarding', async () => {
    const completed = makeMe({ profileComplete: true });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/me/onboarding') return { body: completed };
      if (c.path === '/v1/me') return { body: completed };
      if (c.path === '/v1/me/addresses' && c.method === 'POST') return { status: 201, body: createdAddress };
      return undefined;
    });
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1({ name: 'Asha Raman', gender: 'FEMALE', email: 'asha@example.com' });
    await fireEvent.changeText(await screen.findByTestId('line1'), '12 Gandhi Road');
    await fireEvent.changeText(screen.getByTestId('city'), 'Chennai');
    await fireEvent.changeText(screen.getByTestId('state'), 'Tamil Nadu');
    await fireEvent.changeText(screen.getByTestId('pincode'), '600042');
    await fireEvent.press(screen.getByTestId('onboarding-continue-address'));

    await waitFor(() => expect(useSession.getState().user?.profileComplete).toBe(true));
    const onboardingIndex = calls.findIndex((c) => c.path === '/v1/me/onboarding');
    const addressIndex = calls.findIndex((c) => c.path === '/v1/me/addresses' && c.method === 'POST');
    expect(onboardingIndex).toBeGreaterThanOrEqual(0);
    expect(addressIndex).toBeGreaterThan(onboardingIndex); // onboarding completes first, see finish()
    expect(calls[onboardingIndex]?.body).toEqual({
      fullName: 'Asha Raman',
      dateOfBirth: '1995-07-04',
      gender: 'FEMALE',
      email: 'asha@example.com',
    });
    expect(calls[addressIndex]?.body).toEqual({
      label: 'Home',
      line1: '12 Gandhi Road',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600042',
    });
  });

  it('picking "Work" saves the address under that label instead', async () => {
    const completed = makeMe({ profileComplete: true });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/me/onboarding') return { body: completed };
      if (c.path === '/v1/me') return { body: completed };
      if (c.path === '/v1/me/addresses' && c.method === 'POST') return { status: 201, body: createdAddress };
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
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/v1/me/addresses')?.body).toMatchObject({
        label: 'Work',
      }),
    );
  });

  it('validates the address before calling the server (bad PIN code)', async () => {
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

  it('shows the server error and does not advance into the app when onboarding fails for real', async () => {
    mockApi((c) =>
      c.path === '/v1/me/onboarding'
        ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }
        : undefined,
    );
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await fireEvent.press(await screen.findByTestId('onboarding-skip-address'));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(useSession.getState().user?.profileComplete).toBe(false);
  });

  it('treats "already completed" (409) as success rather than an error — a stranded retry recovers', async () => {
    const completed = makeMe({ profileComplete: true });
    mockApi((c) => {
      if (c.path === '/v1/me/onboarding')
        return { status: 409, body: { error: { code: 'CONFLICT', message: 'Already done.' } } };
      if (c.path === '/v1/me') return { body: completed };
      return undefined;
    });
    await renderWithProviders(<OnboardingScreen />);
    await fillAndAdvanceStep1();
    await fireEvent.press(await screen.findByTestId('onboarding-skip-address'));
    await waitFor(() => expect(useSession.getState().user?.profileComplete).toBe(true));
  });
});
