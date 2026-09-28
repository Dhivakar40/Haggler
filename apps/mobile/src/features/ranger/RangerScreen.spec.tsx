import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import {
  mockApi,
  renderWithProviders,
  routerMock,
  signInAs,
  type MockCall,
} from '../../test-utils';
import { RangerScreen } from './RangerScreen';

const cats = ['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'ac_repair'].map(
  (slug, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    slug,
    nameKey: `categories.${slug}`,
    icon: 'flash',
    requiresLicense: false,
  }),
);
const check = (tier: number, status: string, reviewerMessage: string | null = null) => ({
  id: `33333333-3333-4333-8333-33333333333${tier}`,
  tier,
  status,
  reviewerMessage,
  submittedAt: null,
  decidedAt: null,
  requiredDocuments: [],
  documents: [],
});

function backend(
  kyc: { tier: number; checks: object[] },
  profile = { kycTier: 0, bio: null, experienceYears: null, categorySlugs: [] as string[] },
) {
  return mockApi((c: MockCall) => {
    if (c.path === '/v1/kyc/status') return { body: kyc };
    if (c.path === '/v1/worker/profile')
      return c.method === 'PATCH'
        ? {
            body: {
              ...profile,
              categorySlugs: (c.body as { categorySlugs: string[] }).categorySlugs,
            },
          }
        : { body: profile };
    if (c.path === '/v1/categories') return { body: cats };
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  routerMock().push.mockClear();
  signInAs({ roles: ['CUSTOMER', 'WORKER'] });
});

describe('RangerScreen', () => {
  it('a new Ranger sees both levels, level 2 locked behind level 1', async () => {
    backend({ tier: 0, checks: [] });
    await renderWithProviders(<RangerScreen />);
    expect(await screen.findByTestId('tier-1-status')).toHaveTextContent('Not started');
    expect(screen.getByTestId('tier-1-action')).toBeTruthy();
    expect(screen.getByText('Finish level 1 first.')).toBeTruthy();
    expect(screen.queryByTestId('tier-2-action')).toBeNull();
  });

  it('starting level 1 opens the KYC screen for tier 1', async () => {
    backend({ tier: 0, checks: [] });
    await renderWithProviders(<RangerScreen />);
    await fireEvent.press(await screen.findByTestId('tier-1-action'));
    expect(routerMock().push).toHaveBeenCalledWith({
      pathname: '/kyc/[tier]',
      params: { tier: '1' },
    });
  });

  it("shows the team's message when more info is needed, with a Continue button", async () => {
    backend({ tier: 0, checks: [check(1, 'NEEDS_INFO', 'Selfie is blurry, please retake.')] });
    await renderWithProviders(<RangerScreen />);
    expect(await screen.findByTestId('tier-1-message')).toHaveTextContent(
      'Selfie is blurry, please retake.',
    );
    expect(screen.getByTestId('tier-1-status')).toHaveTextContent('More information needed');
    expect(screen.getByTestId('tier-1-action')).toHaveTextContent('Continue');
  });

  it('a rejected check explains why and offers Start again', async () => {
    backend({ tier: 0, checks: [check(1, 'REJECTED', 'Photo does not match the ID.')] });
    await renderWithProviders(<RangerScreen />);
    expect(await screen.findByTestId('tier-1-message')).toHaveTextContent(
      'Photo does not match the ID.',
    );
    expect(screen.getByTestId('tier-1-action')).toHaveTextContent('Start again');
  });

  it('waiting for review has no action button', async () => {
    backend({ tier: 0, checks: [check(1, 'PENDING_REVIEW')] });
    await renderWithProviders(<RangerScreen />);
    expect(await screen.findByTestId('tier-1-status')).toHaveTextContent('Waiting for review');
    expect(screen.queryByTestId('tier-1-action')).toBeNull();
  });

  it('verified at level 1 unlocks level 2', async () => {
    backend({ tier: 1, checks: [check(1, 'APPROVED')] });
    await renderWithProviders(<RangerScreen />);
    expect(await screen.findByTestId('tier-1-status')).toHaveTextContent('Verified');
    expect(screen.queryByTestId('tier-1-action')).toBeNull();
    expect(screen.queryByText('Finish level 1 first.')).toBeNull();
    expect(screen.getByTestId('tier-2-action')).toBeTruthy();
  });

  it('lets a Ranger choose up to 5 categories and saves them', async () => {
    const { calls } = backend({ tier: 0, checks: [] });
    await renderWithProviders(<RangerScreen />);
    await screen.findByTestId('cat-electrician');
    for (const slug of ['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'ac_repair'])
      await fireEvent.press(screen.getByTestId(`cat-${slug}`));
    // The 6th is ignored: the limit is 5.
    expect(screen.getByTestId('cat-ac_repair').props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId('cat-painter').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('save-categories'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      categorySlugs: ['electrician', 'plumber', 'cleaner', 'carpenter', 'painter'],
    });
  });

  it('pre-selects the categories already saved', async () => {
    backend(
      { tier: 0, checks: [] },
      { kycTier: 0, bio: null, experienceYears: null, categorySlugs: ['plumber'] },
    );
    await renderWithProviders(<RangerScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('cat-plumber').props.accessibilityState.selected).toBe(true),
    );
    expect(screen.getByTestId('cat-electrician').props.accessibilityState.selected).toBe(false);
  });
});
