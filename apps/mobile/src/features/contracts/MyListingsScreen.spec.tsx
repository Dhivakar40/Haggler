import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { MyListingsScreen } from './MyListingsScreen';

const listing = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  employerId: 'bbbbbbbb-1111-4111-8111-111111111111',
  businessName: 'Acme Renovations',
  categorySlug: 'electrician',
  title: 'Site electrician for 2-month fit-out',
  description: 'Rewiring a 3-floor office.',
  payType: 'DAILY',
  payAmountPaise: 150000,
  openings: 2,
  filledCount: 0,
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600042',
  startDate: null,
  status: 'OPEN',
  isBoosted: false,
  createdAt: new Date().toISOString(),
  applicationCount: 3,
  ...over,
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'EMPLOYER'] });
});

describe('MyListingsScreen', () => {
  it('shows an empty state with no listings', async () => {
    mockApi((c) =>
      c.path === '/v1/employer/contracts' ? { body: { items: [], nextCursor: null } } : undefined,
    );
    await renderWithProviders(<MyListingsScreen />);
    await waitFor(() => expect(screen.getByText(/haven.t posted/i)).toBeTruthy());
  });

  it('lists my listings with the applicant count', async () => {
    mockApi((c) =>
      c.path === '/v1/employer/contracts'
        ? { body: { items: [listing()], nextCursor: null } }
        : undefined,
    );
    await renderWithProviders(<MyListingsScreen />);
    await waitFor(() => expect(screen.getByText(/Site electrician/)).toBeTruthy());
    expect(screen.getByText(/3 applicant/)).toBeTruthy();
  });

  it('tapping a listing navigates to its applicants screen', async () => {
    mockApi((c) =>
      c.path === '/v1/employer/contracts'
        ? { body: { items: [listing()], nextCursor: null } }
        : undefined,
    );
    await renderWithProviders(<MyListingsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('listing-aaaaaaaa-1111-4111-8111-111111111111')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('listing-aaaaaaaa-1111-4111-8111-111111111111'));
    expect(routerMock().push).toHaveBeenCalledWith(
      '/employer/listings/aaaaaaaa-1111-4111-8111-111111111111',
    );
  });

  it('post a new listing navigates to the form', async () => {
    mockApi((c) =>
      c.path === '/v1/employer/contracts' ? { body: { items: [], nextCursor: null } } : undefined,
    );
    await renderWithProviders(<MyListingsScreen />);
    await waitFor(() => expect(screen.getByTestId('post-new-listing')).toBeTruthy());
    fireEvent.press(screen.getByTestId('post-new-listing'));
    expect(routerMock().push).toHaveBeenCalledWith('/employer/listings/new');
  });
});
