import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { MyApplicationsScreen } from './MyApplicationsScreen';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'WORKER'] });
});

describe('MyApplicationsScreen', () => {
  it('shows an empty state with no applications', async () => {
    mockApi((c) =>
      c.path.startsWith('/v1/me/contract-applications')
        ? { body: { items: [], nextCursor: null } }
        : undefined,
    );
    await renderWithProviders(<MyApplicationsScreen />);
    await waitFor(() => expect(screen.getByText(/haven.t applied/i)).toBeTruthy());
  });

  it('lists my applications with the listing and business name, and navigates on tap', async () => {
    mockApi((c) =>
      c.path.startsWith('/v1/me/contract-applications')
        ? {
            body: {
              items: [
                {
                  id: 'cccccccc-1111-4111-8111-111111111111',
                  listingId: 'aaaaaaaa-1111-4111-8111-111111111111',
                  workerId: 'dddddddd-1111-4111-8111-111111111111',
                  workerName: 'Me',
                  coverNote: null,
                  status: 'SHORTLISTED',
                  appliedAt: new Date().toISOString(),
                  decidedAt: null,
                  listingTitle: 'Site electrician needed',
                  listingStatus: 'OPEN',
                  businessName: 'Acme Renovations',
                },
              ],
              nextCursor: null,
            },
          }
        : undefined,
    );
    await renderWithProviders(<MyApplicationsScreen />);
    await waitFor(() => expect(screen.getByText('Site electrician needed')).toBeTruthy());
    expect(screen.getByText('Acme Renovations')).toBeTruthy();
    fireEvent.press(screen.getByTestId('my-application-cccccccc-1111-4111-8111-111111111111'));
    expect(routerMock().push).toHaveBeenCalledWith(
      '/contracts/aaaaaaaa-1111-4111-8111-111111111111',
    );
  });
});
