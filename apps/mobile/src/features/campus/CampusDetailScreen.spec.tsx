import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { CampusDetailScreen } from './CampusDetailScreen';

const LISTING_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

const listing = (over: Record<string, unknown> = {}) => ({
  id: LISTING_ID,
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
  createdAt: new Date().toISOString(),
  myApplicationStatus: null,
  ...over,
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'STUDENT'] });
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: LISTING_ID });
});

describe('CampusDetailScreen', () => {
  it('shows the listing and an apply button when I have not applied', async () => {
    mockApi((c) => (c.path === `/v1/campus/${LISTING_ID}` ? { body: listing() } : undefined));
    await renderWithProviders(<CampusDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('apply-to-campus')).toBeTruthy());
  });

  it('a night-shift listing requires opting in before the apply button is enabled', async () => {
    mockApi((c) =>
      c.path === `/v1/campus/${LISTING_ID}` ? { body: listing({ isNightShift: true }) } : undefined,
    );
    await renderWithProviders(<CampusDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('apply-to-campus')).toBeTruthy());
    expect(screen.getByTestId('apply-to-campus').props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('night-shift-accept'));
    await waitFor(() =>
      expect(screen.getByTestId('apply-to-campus').props.accessibilityState?.disabled).toBe(false),
    );
  });

  it('applying posts acceptsNightShift and a cover note, then refreshes to show my status', async () => {
    let applied = false;
    const { calls } = mockApi((c) => {
      if (c.method === 'POST' && c.path === `/v1/campus/${LISTING_ID}/apply`) {
        applied = true;
        return {
          status: 201,
          body: {
            id: 'cccccccc-1111-4111-8111-111111111111',
            listingId: LISTING_ID,
            studentId: 'dddddddd-1111-4111-8111-111111111111',
            studentName: 'Me',
            coverNote: 'Available evenings.',
            acceptsNightShift: false,
            status: 'APPLIED',
            appliedAt: new Date().toISOString(),
            decidedAt: null,
          },
        };
      }
      if (c.path === `/v1/campus/${LISTING_ID}`)
        return { body: listing(applied ? { myApplicationStatus: 'APPLIED' } : {}) };
      return undefined;
    });
    await renderWithProviders(<CampusDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('apply-to-campus')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('campus-cover-note'), 'Available evenings.');
    await waitFor(() =>
      expect(screen.getByTestId('campus-cover-note').props.value).toBe('Available evenings.'),
    );
    fireEvent.press(screen.getByTestId('apply-to-campus'));
    await waitFor(() => expect(screen.getByTestId('my-campus-application-status')).toBeTruthy());
    const applyCall = calls.find((c) => c.path === `/v1/campus/${LISTING_ID}/apply`);
    expect(applyCall?.body).toEqual({
      coverNote: 'Available evenings.',
      acceptsNightShift: false,
    });
  });

  it('an applied student can withdraw', async () => {
    let withdrawn = false;
    mockApi((c) => {
      if (c.method === 'DELETE' && c.path === `/v1/campus/${LISTING_ID}/apply`) {
        withdrawn = true;
        return { body: { ok: true } };
      }
      if (c.path === `/v1/campus/${LISTING_ID}`)
        return { body: listing({ myApplicationStatus: withdrawn ? 'WITHDRAWN' : 'APPLIED' }) };
      return undefined;
    });
    await renderWithProviders(<CampusDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('withdraw-campus-application')).toBeTruthy());
    fireEvent.press(screen.getByTestId('withdraw-campus-application'));
    await waitFor(() => expect(screen.queryByTestId('withdraw-campus-application')).toBeNull());
  });
});
