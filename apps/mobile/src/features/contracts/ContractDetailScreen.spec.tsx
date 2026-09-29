import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { ContractDetailScreen } from './ContractDetailScreen';

const LISTING_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

const listing = (over: Record<string, unknown> = {}) => ({
  id: LISTING_ID,
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
  createdAt: new Date().toISOString(),
  myApplicationStatus: null,
  ...over,
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'WORKER'] });
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: LISTING_ID });
});

describe('ContractDetailScreen', () => {
  it('shows the listing and an apply button when I have not applied', async () => {
    mockApi((c) => (c.path === `/v1/contracts/${LISTING_ID}` ? { body: listing() } : undefined));
    await renderWithProviders(<ContractDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('apply-to-contract')).toBeTruthy());
  });

  it('applying posts a cover note and refreshes to show my status', async () => {
    let applied = false;
    const { calls } = mockApi((c) => {
      if (c.method === 'POST' && c.path === `/v1/contracts/${LISTING_ID}/apply`) {
        applied = true;
        return {
          status: 201,
          body: {
            id: 'cccccccc-1111-4111-8111-111111111111',
            listingId: LISTING_ID,
            workerId: 'dddddddd-1111-4111-8111-111111111111',
            workerName: 'Me',
            coverNote: 'I can start Monday.',
            status: 'APPLIED',
            appliedAt: new Date().toISOString(),
            decidedAt: null,
          },
        };
      }
      if (c.path === `/v1/contracts/${LISTING_ID}`)
        return { body: listing(applied ? { myApplicationStatus: 'APPLIED' } : {}) };
      return undefined;
    });
    await renderWithProviders(<ContractDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('apply-to-contract')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('cover-note'), 'I can start Monday.');
    await waitFor(() =>
      expect(screen.getByTestId('cover-note').props.value).toBe('I can start Monday.'),
    );
    fireEvent.press(screen.getByTestId('apply-to-contract'));
    await waitFor(() => expect(screen.getByTestId('my-application-status')).toBeTruthy());
    const applyCall = calls.find((c) => c.path === `/v1/contracts/${LISTING_ID}/apply`);
    expect(applyCall?.body).toEqual({ coverNote: 'I can start Monday.' });
  });

  it('an applied worker can withdraw', async () => {
    let withdrawn = false;
    mockApi((c) => {
      if (c.method === 'DELETE' && c.path === `/v1/contracts/${LISTING_ID}/apply`) {
        withdrawn = true;
        return { body: { ok: true } };
      }
      if (c.path === `/v1/contracts/${LISTING_ID}`)
        return {
          body: listing({ myApplicationStatus: withdrawn ? 'WITHDRAWN' : 'APPLIED' }),
        };
      return undefined;
    });
    await renderWithProviders(<ContractDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('withdraw-application')).toBeTruthy());
    fireEvent.press(screen.getByTestId('withdraw-application'));
    await waitFor(() => expect(screen.queryByTestId('withdraw-application')).toBeNull());
  });

  it('a hired application cannot be withdrawn (no withdraw button shown)', async () => {
    mockApi((c) =>
      c.path === `/v1/contracts/${LISTING_ID}`
        ? { body: listing({ myApplicationStatus: 'HIRED' }) }
        : undefined,
    );
    await renderWithProviders(<ContractDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('my-application-status')).toBeTruthy());
    expect(screen.queryByTestId('withdraw-application')).toBeNull();
  });

  it('a closed listing with no application shows a not-open message, not an apply button', async () => {
    mockApi((c) =>
      c.path === `/v1/contracts/${LISTING_ID}`
        ? { body: listing({ status: 'CLOSED' }) }
        : undefined,
    );
    await renderWithProviders(<ContractDetailScreen />);
    await waitFor(() => expect(screen.getByText(/no longer accepting applications/)).toBeTruthy());
    expect(screen.queryByTestId('apply-to-contract')).toBeNull();
  });
});
