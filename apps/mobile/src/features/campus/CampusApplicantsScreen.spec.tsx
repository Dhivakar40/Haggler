import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { CampusApplicantsScreen } from './CampusApplicantsScreen';

const LISTING_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

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

const listing = (over: Record<string, unknown> = {}) => ({
  id: LISTING_ID,
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
  ...over,
});

const application = (over: Record<string, unknown> = {}) => ({
  id: 'cccccccc-1111-4111-8111-111111111111',
  listingId: LISTING_ID,
  studentId: 'dddddddd-1111-4111-8111-111111111111',
  studentName: 'Priya',
  coverNote: 'Available on weekdays.',
  acceptsNightShift: false,
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

describe('CampusApplicantsScreen', () => {
  it('lists applicants with their cover note', async () => {
    mockApi((c) => {
      if (c.path === `/v1/campus/${LISTING_ID}`) return { body: listing() };
      if (c.path === `/v1/employer/campus/${LISTING_ID}/applications`)
        return { body: { items: [application()], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<CampusApplicantsScreen />);
    await waitFor(() => expect(screen.getByText('Priya')).toBeTruthy());
    expect(screen.getByText(/weekdays/)).toBeTruthy();
  });

  it('shows a night-shift opt-in note when the applicant accepted one', async () => {
    mockApi((c) => {
      if (c.path === `/v1/campus/${LISTING_ID}`) return { body: listing({ isNightShift: true }) };
      if (c.path === `/v1/employer/campus/${LISTING_ID}/applications`)
        return { body: { items: [application({ acceptsNightShift: true })], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<CampusApplicantsScreen />);
    await waitFor(() => expect(screen.getByText('Opted in to night shifts')).toBeTruthy());
  });

  it('hiring asks for confirmation, then sends the HIRE decision', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === `/v1/campus/${LISTING_ID}`) return { body: listing() };
      if (c.path === `/v1/employer/campus/${LISTING_ID}/applications`)
        return { body: { items: [application()], nextCursor: null } };
      if (
        c.method === 'POST' &&
        c.path ===
          `/v1/employer/campus/${LISTING_ID}/applications/cccccccc-1111-4111-8111-111111111111/decision`
      )
        return { status: 201, body: application({ status: 'HIRED' }) };
      return undefined;
    });
    await renderWithProviders(<CampusApplicantsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('campus-hire-cccccccc-1111-4111-8111-111111111111')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('campus-hire-cccccccc-1111-4111-8111-111111111111'));
    pressAlertButton('Hire');
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path ===
              `/v1/employer/campus/${LISTING_ID}/applications/cccccccc-1111-4111-8111-111111111111/decision` &&
            (c.body as { decision: string }).decision === 'HIRE',
        ),
      ).toBe(true),
    );
  });

  it('a weekly-hours-cap refusal at hire time shows an error, not a crash', async () => {
    mockApi((c) => {
      if (c.path === `/v1/campus/${LISTING_ID}`) return { body: listing() };
      if (c.path === `/v1/employer/campus/${LISTING_ID}/applications`)
        return { body: { items: [application()], nextCursor: null } };
      if (c.method === 'POST' && c.path.includes('/decision'))
        return {
          status: 422,
          body: {
            error: {
              code: 'UNPROCESSABLE',
              message: 'This would put you over the 20-hour weekly cap.',
              details: { code: 'WEEKLY_HOURS_CAP' },
            },
          },
        };
      return undefined;
    });
    await renderWithProviders(<CampusApplicantsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('campus-hire-cccccccc-1111-4111-8111-111111111111')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('campus-hire-cccccccc-1111-4111-8111-111111111111'));
    pressAlertButton('Hire');
    await waitFor(() => expect(screen.getByText(/weekly hours cap/)).toBeTruthy());
  });

  it('an empty applicant list shows the empty state', async () => {
    mockApi((c) => {
      if (c.path === `/v1/campus/${LISTING_ID}`) return { body: listing() };
      if (c.path === `/v1/employer/campus/${LISTING_ID}/applications`)
        return { body: { items: [], nextCursor: null } };
      return undefined;
    });
    await renderWithProviders(<CampusApplicantsScreen />);
    await waitFor(() => expect(screen.getByText(/No one has applied/)).toBeTruthy());
  });
});
