import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { LEGAL_VERSION } from '@haggler/shared';
import i18n from '../../i18n';
import { useSession } from '../../auth/session';
import {
  makeMe,
  mockApi,
  renderWithProviders,
  routerMock,
  secureStore,
  signInAs,
} from '../../test-utils';
import { ConsentScreen } from './ConsentScreen';
import { OtpScreen } from './OtpScreen';
import { PhoneScreen } from './PhoneScreen';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  secureStore().clear();
  routerMock().push.mockClear();
  routerMock().back.mockClear();
  useSession.setState({ status: 'signedOut', user: null, accessToken: null });
});

describe('PhoneScreen', () => {
  it('rejects an invalid number without calling the server', async () => {
    const { calls } = mockApi(() => undefined);
    await renderWithProviders(<PhoneScreen />);
    await fireEvent.changeText(screen.getByTestId('phone-input'), '12345');
    await fireEvent.press(screen.getByTestId('send-code'));
    expect(await screen.findByText('Enter a valid 10-digit Indian mobile number.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('normalises what was typed, sends the code, and opens the OTP screen', async () => {
    const { calls } = mockApi((c) =>
      c.path === '/v1/auth/otp/send'
        ? { body: { sent: true, expiresInSeconds: 300, resendAfterSeconds: 30 } }
        : undefined,
    );
    await renderWithProviders(<PhoneScreen />);
    await fireEvent.changeText(screen.getByTestId('phone-input'), '98765 43210');
    await fireEvent.press(screen.getByTestId('send-code'));
    await waitFor(() =>
      expect(routerMock().push).toHaveBeenCalledWith({
        pathname: '/otp',
        params: { phone: '+919876543210' },
      }),
    );
    expect(calls[0]).toMatchObject({ method: 'POST', body: { phone: '+919876543210' } });
    expect(calls[0]?.headers.Authorization).toBeUndefined(); // sign-in is unauthenticated
  });

  it('says how long to wait when rate limited', async () => {
    mockApi(() => ({
      status: 429,
      body: { error: { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSeconds: 25 } } },
    }));
    await renderWithProviders(<PhoneScreen />);
    await fireEvent.changeText(screen.getByTestId('phone-input'), '9876543210');
    await fireEvent.press(screen.getByTestId('send-code'));
    expect(await screen.findByText('Too many attempts. Try again in 25 seconds.')).toBeTruthy();
    expect(routerMock().push).not.toHaveBeenCalled();
  });

  it('is shown in the chosen language', async () => {
    await i18n.changeLanguage('ta');
    mockApi(() => undefined);
    await renderWithProviders(<PhoneScreen />);
    expect(screen.getByText('உங்கள் மொபைல் எண்ணை உள்ளிடவும்')).toBeTruthy();
  });
});

describe('OtpScreen', () => {
  const session = {
    accessToken: 'access-1',
    refreshToken: 'refresh-token-number-1-xxxxxxxx',
    expiresInSeconds: 900,
    isNewUser: true,
    user: makeMe({ missingConsents: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'KYC_PROCESSING'] }),
  };
  beforeEach(() => (useLocalSearchParams as jest.Mock).mockReturnValue({ phone: '+919876543210' }));

  it('verifies the code with this device id and starts the session', async () => {
    const { calls } = mockApi((c) =>
      c.path === '/v1/auth/otp/verify' ? { body: session } : undefined,
    );
    await renderWithProviders(<OtpScreen />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    await fireEvent.press(screen.getByTestId('verify'));
    await waitFor(() => expect(useSession.getState().status).toBe('signedIn'));
    expect(calls[0]?.body).toMatchObject({
      phone: '+919876543210',
      code: '123456',
      deviceId: 'test-device-uuid-0001',
    });
    expect(secureStore().get('haggler.refresh')).toBe(session.refreshToken);
    expect(useSession.getState().user?.missingConsents).toHaveLength(3);
  });

  it('shows a clear message for a wrong code and stays signed out', async () => {
    mockApi(() => ({ status: 400, body: { error: { code: 'OTP_INVALID', message: 'x' } } }));
    await renderWithProviders(<OtpScreen />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '000000');
    await fireEvent.press(screen.getByTestId('verify'));
    expect(await screen.findByText('That code is incorrect or has expired.')).toBeTruthy();
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('only accepts digits, at most 6, and never calls the server for a short code', async () => {
    const { calls } = mockApi(() => undefined);
    await renderWithProviders(<OtpScreen />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '12ab34567890');
    expect(screen.getByTestId('otp-input').props.value).toBe('123456');
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123');
    await fireEvent.press(screen.getByTestId('verify'));
    expect(await screen.findByText('That code is incorrect or has expired.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('resend is disabled during the 30 s cooldown and shows the countdown', async () => {
    mockApi(() => undefined);
    await renderWithProviders(<OtpScreen />);
    expect(screen.getByText(/Resend in \d+s/)).toBeTruthy();
    expect(screen.getByTestId('resend').props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('ConsentScreen (DPDP)', () => {
  beforeEach(() =>
    signInAs({ missingConsents: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'KYC_PROCESSING'] }),
  );

  it('shows the placeholder-legal-text warning', async () => {
    mockApi(() => undefined);
    await renderWithProviders(<ConsentScreen />);
    expect(screen.getByText(/Placeholder text\. A lawyer has not reviewed this yet/)).toBeTruthy();
  });

  it('requires BOTH boxes; nothing is sent otherwise', async () => {
    const { calls } = mockApi(() => undefined);
    await renderWithProviders(<ConsentScreen />);
    await fireEvent.press(screen.getByTestId('consent-terms'));
    await fireEvent.press(screen.getByTestId('consent-agree'));
    expect(await screen.findByText('You need to agree to both to continue.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('records each consent at the current legal version, then refreshes the account', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/me/consents')
        return { status: 201, body: { purpose: (c.body as { purpose: string }).purpose } };
      if (c.path === '/v1/me') return { body: makeMe({ missingConsents: ['KYC_PROCESSING'] }) };
    });
    await renderWithProviders(<ConsentScreen />);
    await fireEvent.press(screen.getByTestId('consent-terms'));
    await fireEvent.press(screen.getByTestId('consent-privacy'));
    await fireEvent.press(screen.getByTestId('consent-agree'));
    await waitFor(() =>
      expect(useSession.getState().user?.missingConsents).toEqual(['KYC_PROCESSING']),
    );
    const posted = calls.filter((c) => c.path === '/v1/me/consents').map((c) => c.body);
    expect(posted).toEqual([
      { purpose: 'TERMS_OF_SERVICE', version: LEGAL_VERSION },
      { purpose: 'PRIVACY_POLICY', version: LEGAL_VERSION },
    ]);
  });
});
