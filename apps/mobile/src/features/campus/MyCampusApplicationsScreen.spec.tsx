import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { MyCampusApplicationsScreen } from './MyCampusApplicationsScreen';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'STUDENT'] });
});

describe('MyCampusApplicationsScreen', () => {
  it('shows an empty state with no applications', async () => {
    mockApi((c) =>
      c.path.startsWith('/v1/me/campus-applications')
        ? { body: { items: [], nextCursor: null } }
        : undefined,
    );
    await renderWithProviders(<MyCampusApplicationsScreen />);
    await waitFor(() => expect(screen.getByText(/haven.t applied/i)).toBeTruthy());
  });

  it('lists my applications with the listing and business name, and navigates on tap', async () => {
    mockApi((c) =>
      c.path.startsWith('/v1/me/campus-applications')
        ? {
            body: {
              items: [
                {
                  id: 'cccccccc-1111-4111-8111-111111111111',
                  listingId: 'aaaaaaaa-1111-4111-8111-111111111111',
                  studentId: 'dddddddd-1111-4111-8111-111111111111',
                  studentName: 'Me',
                  coverNote: null,
                  acceptsNightShift: false,
                  status: 'SHORTLISTED',
                  appliedAt: new Date().toISOString(),
                  decidedAt: null,
                  listingTitle: 'Front-desk help, evenings',
                  listingStatus: 'OPEN',
                  businessName: 'Acme Tutoring',
                },
              ],
              nextCursor: null,
            },
          }
        : undefined,
    );
    await renderWithProviders(<MyCampusApplicationsScreen />);
    await waitFor(() => expect(screen.getByText('Front-desk help, evenings')).toBeTruthy());
    expect(screen.getByText('Acme Tutoring')).toBeTruthy();
    fireEvent.press(
      screen.getByTestId('my-campus-application-cccccccc-1111-4111-8111-111111111111'),
    );
    expect(routerMock().push).toHaveBeenCalledWith('/campus/aaaaaaaa-1111-4111-8111-111111111111');
  });
});
