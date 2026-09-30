import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { BrowseContractsScreen } from './BrowseContractsScreen';

const cats = [
  {
    id: '00000000-0000-4000-8000-000000000000',
    slug: 'electrician',
    nameKey: 'categories.electrician',
    icon: 'flash',
    requiresLicense: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'plumber',
    nameKey: 'categories.plumber',
    icon: 'water',
    requiresLicense: false,
  },
];

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
  myApplicationStatus: null,
  ...over,
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'WORKER'] });
});

describe('BrowseContractsScreen', () => {
  it('lists open listings', async () => {
    mockApi((c) => {
      if (c.path === '/v1/categories') return { body: cats };
      if (c.path.startsWith('/v1/contracts?'))
        return { body: { items: [listing()], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<BrowseContractsScreen />);
    await waitFor(() => expect(screen.getByText(/Site electrician/)).toBeTruthy());
    expect(screen.getByText(/Acme Renovations/)).toBeTruthy();
  });

  it('shows my application status on a listing I already applied to', async () => {
    mockApi((c) => {
      if (c.path === '/v1/categories') return { body: cats };
      if (c.path.startsWith('/v1/contracts?'))
        return { body: { items: [listing({ myApplicationStatus: 'APPLIED' })], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<BrowseContractsScreen />);
    await waitFor(() =>
      expect(
        screen.getByTestId('browse-listing-aaaaaaaa-1111-4111-8111-111111111111-status'),
      ).toBeTruthy(),
    );
  });

  it('filtering by category re-requests the list', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/categories') return { body: cats };
      if (c.path.startsWith('/v1/contracts?'))
        return { body: { items: [listing()], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<BrowseContractsScreen />);
    await waitFor(() => expect(screen.getByTestId('browse-cat-plumber')).toBeTruthy());
    fireEvent.press(screen.getByTestId('browse-cat-plumber'));
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes('categorySlug=plumber'))).toBe(true),
    );
  });

  it('tapping a listing navigates to its detail screen', async () => {
    mockApi((c) => {
      if (c.path === '/v1/categories') return { body: cats };
      if (c.path.startsWith('/v1/contracts?'))
        return { body: { items: [listing()], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<BrowseContractsScreen />);
    await waitFor(() =>
      expect(
        screen.getByTestId('browse-listing-aaaaaaaa-1111-4111-8111-111111111111'),
      ).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('browse-listing-aaaaaaaa-1111-4111-8111-111111111111'));
    expect(routerMock().push).toHaveBeenCalledWith(
      '/contracts/aaaaaaaa-1111-4111-8111-111111111111',
    );
  });
});
