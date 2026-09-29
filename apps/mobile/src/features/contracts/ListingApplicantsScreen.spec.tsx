import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { ListingApplicantsScreen } from './ListingApplicantsScreen';

const pressAlertButton = (label: string) => {
  const args = (Alert.alert as jest.Mock).mock.calls.at(-1) as [
    string,
    string | undefined,
    { text: string; onPress?: () => void }[],
  ];
  const btn = args[2].find((b) => b.text === label);
  if (!btn?.onPress) throw new Error(`no alert button ${label}`);
  btn.onPress();
};

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
  ...over,
});

const application = (over: Record<string, unknown> = {}) => ({
  id: 'cccccccc-1111-4111-8111-111111111111',
  listingId: LISTING_ID,
  workerId: 'dddddddd-1111-4111-8111-111111111111',
  workerName: 'Ravi Kumar',
  coverNote: 'I did similar work last year.',
  status: 'APPLIED',
  appliedAt: new Date().toISOString(),
  decidedAt: null,
  ...over,
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'EMPLOYER'] });
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: LISTING_ID });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('ListingApplicantsScreen', () => {
  it('lists applicants with their cover note', async () => {
    mockApi((c) => {
      if (c.path === `/v1/contracts/${LISTING_ID}`) return { body: listing() };
      if (c.path === `/v1/employer/contracts/${LISTING_ID}/applications`)
        return { body: { items: [application()], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<ListingApplicantsScreen />);
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeTruthy());
    expect(screen.getByText(/similar work last year/)).toBeTruthy();
  });

  it('hiring asks for confirmation, then sends the HIRE decision', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === `/v1/contracts/${LISTING_ID}`) return { body: listing() };
      if (c.path === `/v1/employer/contracts/${LISTING_ID}/applications`)
        return { body: { items: [application()], nextCursor: null } };
      if (
        c.method === 'POST' &&
        c.path ===
          `/v1/employer/contracts/${LISTING_ID}/applications/cccccccc-1111-4111-8111-111111111111/decision`
      )
        return { status: 201, body: application({ status: 'HIRED' }) };
      return undefined;
    });
    await renderWithProviders(<ListingApplicantsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('hire-cccccccc-1111-4111-8111-111111111111')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('hire-cccccccc-1111-4111-8111-111111111111'));
    pressAlertButton('Hire');
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path ===
              `/v1/employer/contracts/${LISTING_ID}/applications/cccccccc-1111-4111-8111-111111111111/decision` &&
            (c.body as { decision: string }).decision === 'HIRE',
        ),
      ).toBe(true),
    );
  });

  it('rejecting does not require confirmation', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === `/v1/contracts/${LISTING_ID}`) return { body: listing() };
      if (c.path === `/v1/employer/contracts/${LISTING_ID}/applications`)
        return { body: { items: [application()], nextCursor: null } };
      if (
        c.method === 'POST' &&
        c.path ===
          `/v1/employer/contracts/${LISTING_ID}/applications/cccccccc-1111-4111-8111-111111111111/decision`
      )
        return { status: 201, body: application({ status: 'REJECTED' }) };
      return undefined;
    });
    await renderWithProviders(<ListingApplicantsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('reject-cccccccc-1111-4111-8111-111111111111')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('reject-cccccccc-1111-4111-8111-111111111111'));
    await waitFor(() =>
      expect(
        calls.some((c) => (c.body as { decision: string } | undefined)?.decision === 'REJECT'),
      ).toBe(true),
    );
  });

  it('an empty applicant list shows the empty state', async () => {
    mockApi((c) => {
      if (c.path === `/v1/contracts/${LISTING_ID}`) return { body: listing() };
      if (c.path === `/v1/employer/contracts/${LISTING_ID}/applications`)
        return { body: { items: [], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<ListingApplicantsScreen />);
    await waitFor(() => expect(screen.getByText(/No one has applied/)).toBeTruthy());
  });
});
