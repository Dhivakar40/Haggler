import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { useSession } from '../../auth/session';
import { makeMe, mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { OnboardingScreen } from './OnboardingScreen';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  signInAs({ profileComplete: false });
});

describe('OnboardingScreen', () => {
  it('refuses to submit until name, date of birth, gender and email are all filled in', async () => {
    const { calls } = mockApi(() => undefined);
    await renderWithProviders(<OnboardingScreen />);
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    expect(await screen.findByText('Enter your full name.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('rejects an impossible date of birth before ever calling the server', async () => {
    mockApi(() => undefined);
    await renderWithProviders(<OnboardingScreen />);
    await fireEvent.changeText(screen.getByTestId('onboarding-name'), 'Asha Raman');
    await fireEvent.changeText(screen.getByTestId('dob-day'), '31');
    await fireEvent.changeText(screen.getByTestId('dob-month'), '02');
    await fireEvent.changeText(screen.getByTestId('dob-year'), '1995');
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    expect(await screen.findByText('Enter a valid date of birth.')).toBeTruthy();
  });

  it('submits the completed setup and the session reflects profileComplete', async () => {
    const completed = makeMe({ fullName: 'Asha Raman', profileComplete: true });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/me/onboarding') return { body: completed };
      if (c.path === '/v1/me') return { body: completed };
      return undefined;
    });
    await renderWithProviders(<OnboardingScreen />);
    await fireEvent.changeText(screen.getByTestId('onboarding-name'), 'Asha Raman');
    await fireEvent.changeText(screen.getByTestId('dob-day'), '04');
    await fireEvent.changeText(screen.getByTestId('dob-month'), '07');
    await fireEvent.changeText(screen.getByTestId('dob-year'), '1995');
    await fireEvent.press(screen.getByTestId('gender-FEMALE'));
    await fireEvent.changeText(screen.getByTestId('email-input'), 'asha@example.com');
    await fireEvent.press(screen.getByTestId('onboarding-continue'));

    await waitFor(() => expect(useSession.getState().user?.profileComplete).toBe(true));
    const onboardingCall = calls.find((c) => c.path === '/v1/me/onboarding');
    expect(onboardingCall?.body).toEqual({
      fullName: 'Asha Raman',
      dateOfBirth: '1995-07-04',
      gender: 'FEMALE',
      email: 'asha@example.com',
    });
  });

  it('shows the server error and does not advance when onboarding fails', async () => {
    mockApi((c) =>
      c.path === '/v1/me/onboarding'
        ? { status: 409, body: { error: { code: 'CONFLICT', message: 'Already done.' } } }
        : undefined,
    );
    await renderWithProviders(<OnboardingScreen />);
    await fireEvent.changeText(screen.getByTestId('onboarding-name'), 'Asha Raman');
    await fireEvent.changeText(screen.getByTestId('dob-day'), '04');
    await fireEvent.changeText(screen.getByTestId('dob-month'), '07');
    await fireEvent.changeText(screen.getByTestId('dob-year'), '1995');
    await fireEvent.press(screen.getByTestId('gender-MALE'));
    await fireEvent.changeText(screen.getByTestId('email-input'), 'asha@example.com');
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(useSession.getState().user?.profileComplete).toBe(false);
  });
});
