import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { BrowseCampusScreen } from './BrowseCampusScreen';

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
  businessName: 'Acme Tutoring',
  categorySlug: 'electrician',
  title: 'Front-desk help, evenings',
  description: 'Answering phones at our tutoring centre.',
  hourlyRatePaise: 15000,
  hoursPerWeek: 12,
  isNightShift: false,
  openings: 1,
  filledCount: 0,
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600042',
  status: 'OPEN',
  isBoosted: false,
  createdAt: new Date().toISOString(),
  myApplicationStatus: null,
  ...over,
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'STUDENT'] });
});

describe('BrowseCampusScreen', () => {
  it('lists open listings', async () => {
    mockApi((c) => {
      if (c.path === '/v1/categories') return { body: cats };
      if (c.path.startsWith('/v1/campus?'))
        return { body: { items: [listing()], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<BrowseCampusScreen />);
    await waitFor(() => expect(screen.getByText(/Front-desk help/)).toBeTruthy());
    expect(screen.getByText(/Acme Tutoring/)).toBeTruthy();
  });

  it('shows a night-shift note', async () => {
    mockApi((c) => {
      if (c.path === '/v1/categories') return { body: cats };
      if (c.path.startsWith('/v1/campus?'))
        return { body: { items: [listing({ isNightShift: true })], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<BrowseCampusScreen />);
    await waitFor(() => expect(screen.getByText('Night shift')).toBeTruthy());
  });

  it('filtering by category re-requests the list', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/categories') return { body: cats };
      if (c.path.startsWith('/v1/campus?'))
        return { body: { items: [listing()], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<BrowseCampusScreen />);
    await waitFor(() => expect(screen.getByTestId('campus-browse-cat-plumber')).toBeTruthy());
    fireEvent.press(screen.getByTestId('campus-browse-cat-plumber'));
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes('categorySlug=plumber'))).toBe(true),
    );
  });

  it('tapping a listing navigates to its detail screen', async () => {
    mockApi((c) => {
      if (c.path === '/v1/categories') return { body: cats };
      if (c.path.startsWith('/v1/campus?'))
        return { body: { items: [listing()], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<BrowseCampusScreen />);
    await waitFor(() =>
      expect(
        screen.getByTestId('campus-browse-listing-aaaaaaaa-1111-4111-8111-111111111111'),
      ).toBeTruthy(),
    );
    fireEvent.press(
      screen.getByTestId('campus-browse-listing-aaaaaaaa-1111-4111-8111-111111111111'),
    );
    expect(routerMock().push).toHaveBeenCalledWith('/campus/aaaaaaaa-1111-4111-8111-111111111111');
  });
});
