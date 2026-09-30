import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { MyCampusListingsScreen } from './MyCampusListingsScreen';

const listing = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  employerId: 'bbbbbbbb-1111-4111-8111-111111111111',
  businessName: 'Acme Tutoring',
  categorySlug: 'electrician',
  title: 'Front-desk help, evenings',
  description: 'Answering phones.',
  hourlyRatePaise: 15000,
  hoursPerWeek: 12,
  isNightShift: false,
  openings: 2,
  filledCount: 0,
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600042',
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

describe('MyCampusListingsScreen', () => {
  it('shows an empty state with no listings', async () => {
    mockApi((c) =>
      c.path === '/v1/employer/campus' ? { body: { items: [], nextCursor: null } } : undefined,
    );
    await renderWithProviders(<MyCampusListingsScreen />);
    await waitFor(() => expect(screen.getByText(/haven.t posted/i)).toBeTruthy());
  });

  it('lists my listings with the applicant count', async () => {
    mockApi((c) =>
      c.path === '/v1/employer/campus'
        ? { body: { items: [listing()], nextCursor: null } }
        : undefined,
    );
    await renderWithProviders(<MyCampusListingsScreen />);
    await waitFor(() => expect(screen.getByText(/Front-desk help/)).toBeTruthy());
    expect(screen.getByText(/3 applicant/)).toBeTruthy();
  });

  it('tapping a listing navigates to its applicants screen', async () => {
    mockApi((c) =>
      c.path === '/v1/employer/campus'
        ? { body: { items: [listing()], nextCursor: null } }
        : undefined,
    );
    await renderWithProviders(<MyCampusListingsScreen />);
    await waitFor(() =>
      expect(
        screen.getByTestId('campus-listing-aaaaaaaa-1111-4111-8111-111111111111'),
      ).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('campus-listing-aaaaaaaa-1111-4111-8111-111111111111'));
    expect(routerMock().push).toHaveBeenCalledWith(
      '/employer/campus/aaaaaaaa-1111-4111-8111-111111111111',
    );
  });

  it('post a new listing navigates to the form', async () => {
    mockApi((c) =>
      c.path === '/v1/employer/campus' ? { body: { items: [], nextCursor: null } } : undefined,
    );
    await renderWithProviders(<MyCampusListingsScreen />);
    await waitFor(() => expect(screen.getByTestId('post-new-campus-listing')).toBeTruthy());
    fireEvent.press(screen.getByTestId('post-new-campus-listing'));
    expect(routerMock().push).toHaveBeenCalledWith('/employer/campus/new');
  });
});
