import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { Alert, Share } from 'react-native';
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
import { AccountScreen } from './AccountScreen';
import { AddressesScreen, NewAddressScreen } from './AddressesScreens';
import { ContactsScreen } from './ContactsScreen';
import { DeleteAccountScreen } from './DeleteAccountScreen';
import { ProfileScreen } from './ProfileScreen';

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
  secureStore().clear();
  signInAs();
});

const everyText = () => JSON.stringify(screen.toJSON()).toLowerCase();

describe('AccountScreen', () => {
  it('a customer is offered "Become a Ranger"; the word "worker" never appears', async () => {
    mockApi(() => undefined);
    await renderWithProviders(<AccountScreen />);
    expect(screen.getByText('Asha Raman')).toBeTruthy();
    expect(screen.getByText('Signed in as +91 98765 43210')).toBeTruthy();
    expect(screen.getByTestId('roles')).toHaveTextContent('Your roles: Customer');
    expect(screen.getByTestId('become-ranger')).toBeTruthy();
    expect(everyText()).not.toContain('worker');
  });

  it('opens the wallet', async () => {
    mockApi(() => undefined);
    await renderWithProviders(<AccountScreen />);
    await fireEvent.press(screen.getByTestId('open-wallet'));
    expect(routerMock().push).toHaveBeenCalledWith('/wallet');
  });

  it('becoming a Ranger adds the role on the server, refreshes the account and opens verification', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/me/roles')
        return { status: 201, body: makeMe({ roles: ['CUSTOMER', 'WORKER'], workerKycTier: 0 }) };
      if (c.path === '/v1/me')
        return { body: makeMe({ roles: ['CUSTOMER', 'WORKER'], workerKycTier: 0 }) };
    });
    await renderWithProviders(<AccountScreen />);
    await fireEvent.press(screen.getByTestId('become-ranger'));
    await waitFor(() => expect(routerMock().push).toHaveBeenCalledWith('/ranger'));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/me/roles',
      body: { role: 'WORKER' },
    });
    expect(useSession.getState().user?.roles).toEqual(['CUSTOMER', 'WORKER']);
  });

  it('a Ranger sees "Ranger" everywhere and a verification button instead', async () => {
    signInAs({ roles: ['CUSTOMER', 'WORKER'] });
    mockApi(() => undefined);
    await renderWithProviders(<AccountScreen />);
    expect(screen.getByTestId('roles')).toHaveTextContent('Your roles: Customer, Ranger');
    expect(screen.queryByTestId('become-ranger')).toBeNull();
    await fireEvent.press(screen.getByTestId('ranger-verification'));
    expect(routerMock().push).toHaveBeenCalledWith('/ranger');
    expect(everyText()).not.toContain('worker');
  });

  it('shows Ranger in Tamil too', async () => {
    await i18n.changeLanguage('ta');
    signInAs({ roles: ['CUSTOMER', 'WORKER'] });
    mockApi(() => undefined);
    await renderWithProviders(<AccountScreen />);
    expect(screen.getByTestId('roles')).toHaveTextContent(
      'உங்கள் பங்குகள்: வாடிக்கையாளர், ரேஞ்சர்',
    );
  });

  it('exports my data and opens the share sheet with the JSON', async () => {
    mockApi((c) => (c.path === '/v1/me/export' ? { body: { account: { id: 'x' } } } : undefined));
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await renderWithProviders(<AccountScreen />);
    await fireEvent.press(screen.getByText('Download my data'));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(JSON.parse((share.mock.calls[0]?.[0] as { message: string }).message)).toEqual({
      account: { id: 'x' },
    });
  });

  it('a failed export says so', async () => {
    mockApi(() => ({ status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }));
    await renderWithProviders(<AccountScreen />);
    await fireEvent.press(screen.getByText('Download my data'));
    expect(await screen.findByText('Could not export your data.')).toBeTruthy();
  });

  it('signing out clears the session', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    mockApi(() => ({ status: 204 }));
    await renderWithProviders(<AccountScreen />);
    await fireEvent.press(screen.getByText('Sign out'));
    await waitFor(() => expect(useSession.getState().status).toBe('signedOut'));
    expect(secureStore().size).toBe(0);
  });
});

describe('ProfileScreen', () => {
  it('saves the name and languages, refreshes the account and goes back', async () => {
    const { calls } = mockApi((c) => {
      if (c.method === 'PATCH')
        return { body: makeMe({ fullName: 'Asha R', languages: ['en', 'ta'] }) };
      if (c.path === '/v1/me')
        return { body: makeMe({ fullName: 'Asha R', languages: ['en', 'ta'] }) };
    });
    await renderWithProviders(<ProfileScreen />);
    await fireEvent.changeText(screen.getByTestId('name-input'), '  Asha R ');
    await fireEvent.press(screen.getByTestId('spoken-ta'));
    await fireEvent.press(screen.getByTestId('save-profile'));
    await waitFor(() => expect(routerMock().back).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({ fullName: 'Asha R', languages: ['en', 'ta'] });
    expect(useSession.getState().user?.fullName).toBe('Asha R');
  });

  it('keeps at least one language selected', async () => {
    mockApi(() => undefined);
    await renderWithProviders(<ProfileScreen />);
    await fireEvent.press(screen.getByTestId('spoken-en')); // the only one: cannot be removed
    expect(screen.getByTestId('spoken-en').props.accessibilityState.selected).toBe(true);
  });
});

describe('addresses', () => {
  const addr = (over = {}) => ({
    id: '55555555-5555-4555-8555-555555555555',
    label: 'Home',
    line1: '12 Gandhi Road',
    line2: null,
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600042',
    isDefault: true,
    latitude: 12.97,
    longitude: 80.22,
    ...over,
  });

  it('lists saved addresses with the default marked', async () => {
    mockApi((c) =>
      c.path === '/v1/me/addresses'
        ? {
            body: [
              addr(),
              addr({
                id: '66666666-6666-4666-8666-666666666666',
                label: 'Office',
                isDefault: false,
              }),
            ],
          }
        : undefined,
    );
    await renderWithProviders(<AddressesScreen />);
    expect(await screen.findByText('Home · Default')).toBeTruthy();
    expect(screen.getByText('Office')).toBeTruthy();
    expect(screen.getAllByText('Make default')).toHaveLength(1); // not offered on the default one
  });

  it('shows an empty state', async () => {
    mockApi(() => ({ body: [] }));
    await renderWithProviders(<AddressesScreen />);
    expect(await screen.findByText('You have not saved an address yet.')).toBeTruthy();
  });

  it('removing asks for confirmation first, then deletes on the server', async () => {
    let list = [addr()];
    const { calls } = mockApi((c) => {
      if (c.method === 'DELETE') {
        list = [];
        return { status: 204 };
      }
      return { body: list };
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithProviders(<AddressesScreen />);
    await fireEvent.press(await screen.findByText('Remove'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false); // not yet
    const buttons = alert.mock.calls[0]?.[2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Remove')?.onPress?.();
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith(addr().id))).toBe(true),
    );
  });

  it('"Use my current location" captures real GPS coordinates and autofills the area', async () => {
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    loc.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 12.9716, longitude: 80.2209 },
    });
    loc.reverseGeocodeAsync.mockResolvedValue([
      { city: 'Chennai', region: 'Tamil Nadu', postalCode: '600042' },
    ]);
    const { calls } = mockApi((c) =>
      c.method === 'POST' ? { status: 201, body: addr() } : { body: [] },
    );
    await renderWithProviders(<NewAddressScreen />);
    await fireEvent.press(screen.getByTestId('use-location'));
    expect(await screen.findByText('Location captured')).toBeTruthy();
    expect(screen.getByTestId('city').props.value).toBe('Chennai');
    expect(screen.getByTestId('pincode').props.value).toBe('600042');
    await fireEvent.changeText(screen.getByTestId('label'), 'Home');
    await fireEvent.changeText(screen.getByTestId('line1'), '12 Gandhi Road');
    await fireEvent.press(screen.getByTestId('save-address'));
    await waitFor(() => expect(routerMock().back).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      label: 'Home',
      line1: '12 Gandhi Road',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600042',
      latitude: 12.9716,
      longitude: 80.2209,
    });
  });

  it('location permission denied: says so, and the address can still be typed and saved without coordinates', async () => {
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const { calls } = mockApi((c) =>
      c.method === 'POST'
        ? { status: 201, body: addr({ latitude: null, longitude: null }) }
        : { body: [] },
    );
    await renderWithProviders(<NewAddressScreen />);
    await fireEvent.press(screen.getByTestId('use-location'));
    expect(
      await screen.findByText('Location permission is off. You can still type the address.'),
    ).toBeTruthy();
    for (const [id, v] of [
      ['label', 'Home'],
      ['line1', '12 Gandhi Road'],
      ['city', 'Chennai'],
      ['state', 'Tamil Nadu'],
      ['pincode', '600042'],
    ] as const) {
      await fireEvent.changeText(screen.getByTestId(id), v);
    }
    await fireEvent.press(screen.getByTestId('save-address'));
    await waitFor(() => expect(routerMock().back).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST')?.body).not.toHaveProperty('latitude');
  });

  it('validates before calling the server (bad PIN code)', async () => {
    const { calls } = mockApi(() => undefined);
    await renderWithProviders(<NewAddressScreen />);
    for (const [id, v] of [
      ['label', 'Home'],
      ['line1', '12 Gandhi Road'],
      ['city', 'Chennai'],
      ['state', 'Tamil Nadu'],
      ['pincode', '6000'],
    ] as const) {
      await fireEvent.changeText(screen.getByTestId(id), v);
    }
    await fireEvent.press(screen.getByTestId('save-address'));
    expect(await screen.findByText('Please check the address details.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe('emergency contacts', () => {
  const contact = {
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Meena',
    phone: '+919812345678',
    relationship: 'Sister',
  };

  it('lists contacts with formatted numbers', async () => {
    mockApi(() => ({ body: [contact] }));
    await renderWithProviders(<ContactsScreen />);
    expect(await screen.findByText('Meena')).toBeTruthy();
    expect(screen.getByText('Sister · +91 98123 45678')).toBeTruthy();
  });

  it('adds a contact with a normalised phone number', async () => {
    const list: object[] = [];
    const { calls } = mockApi((c) => {
      if (c.method === 'POST') {
        list.push(contact);
        return { status: 201, body: contact };
      }
      return { body: list };
    });
    await renderWithProviders(<ContactsScreen />);
    await fireEvent.changeText(await screen.findByTestId('contact-name'), 'Meena');
    await fireEvent.changeText(screen.getByTestId('contact-phone'), '98123 45678');
    await fireEvent.changeText(screen.getByTestId('contact-relationship'), 'Sister');
    await fireEvent.press(screen.getByTestId('save-contact'));
    await waitFor(() => expect(screen.getByText('Meena')).toBeTruthy());
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Meena',
      phone: '+919812345678',
      relationship: 'Sister',
    });
  });

  it('refuses an invalid contact without calling the server', async () => {
    const { calls } = mockApi(() => ({ body: [] }));
    await renderWithProviders(<ContactsScreen />);
    await fireEvent.changeText(await screen.findByTestId('contact-name'), 'M');
    await fireEvent.press(screen.getByTestId('save-contact'));
    expect(
      await screen.findByText('Enter a name, a 10-digit mobile number and the relationship.'),
    ).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('hides the add form at the 5-contact limit', async () => {
    mockApi(() => ({
      body: Array.from({ length: 5 }, (_, i) => ({
        ...contact,
        id: `77777777-7777-4777-8777-77777777777${i}`,
        name: `C${i}`,
      })),
    }));
    await renderWithProviders(<ContactsScreen />);
    await screen.findByText('C0');
    expect(screen.queryByTestId('save-contact')).toBeNull();
  });

  it('removes a contact', async () => {
    const { calls } = mockApi((c) =>
      c.method === 'DELETE' ? { status: 204 } : { body: [contact] },
    );
    await renderWithProviders(<ContactsScreen />);
    await fireEvent.press(await screen.findByText('Remove'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith(contact.id))).toBe(true),
    );
  });
});

describe('DeleteAccountScreen', () => {
  it('requests deletion, then signs this phone out', async () => {
    secureStore().set('haggler.refresh', 'refresh-token-number-0-xxxxxxxx');
    const { calls } = mockApi((c) =>
      c.path === '/v1/me' ? { status: 202, body: { status: 'DELETION_PENDING' } } : { status: 204 },
    );
    await renderWithProviders(<DeleteAccountScreen />);
    expect(
      screen.getByText('Your account will be locked now and permanently erased after 30 days.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-delete'));
    await waitFor(() => expect(useSession.getState().status).toBe('signedOut'));
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/v1/me' });
    expect(secureStore().size).toBe(0);
  });

  it('"Keep my account" does nothing destructive', async () => {
    const { calls } = mockApi(() => undefined);
    await renderWithProviders(<DeleteAccountScreen />);
    await fireEvent.press(screen.getByText('Keep my account'));
    expect(routerMock().back).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(useSession.getState().status).toBe('signedIn');
  });

  it('if the request fails the user stays signed in and sees an error', async () => {
    mockApi(() => ({ status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }));
    await renderWithProviders(<DeleteAccountScreen />);
    await fireEvent.press(screen.getByTestId('confirm-delete'));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(useSession.getState().status).toBe('signedIn');
  });
});
