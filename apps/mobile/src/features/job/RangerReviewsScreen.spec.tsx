import { screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { RangerReviewsScreen } from './RangerReviewsScreen';

const WORKER_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: WORKER_ID });
});

describe('RangerReviewsScreen', () => {
  it("lists reviews with stars and the reviewer's first name", async () => {
    mockApi((c) =>
      c.path.startsWith(`/v1/rangers/${WORKER_ID}/reviews`)
        ? {
            body: {
              items: [
                {
                  id: 'aaaaaaaa-1111-4111-8111-111111111111',
                  rating: 5,
                  comment: 'Great work!',
                  customerFirstName: 'Asha',
                  createdAt: new Date().toISOString(),
                },
                {
                  id: 'bbbbbbbb-2222-4222-8222-222222222222',
                  rating: 3,
                  comment: null,
                  customerFirstName: 'Meena',
                  createdAt: new Date().toISOString(),
                },
              ],
              nextCursor: null,
            },
          }
        : undefined,
    );
    await renderWithProviders(<RangerReviewsScreen />);
    expect(await screen.findByText('Great work!')).toBeTruthy();
    expect(screen.getByText('Asha')).toBeTruthy();
    expect(screen.getByText('Meena')).toBeTruthy();
    expect(screen.getByTestId('review-aaaaaaaa-1111-4111-8111-111111111111')).toBeTruthy();
    expect(screen.getByTestId('review-bbbbbbbb-2222-4222-8222-222222222222')).toBeTruthy();
  });

  it('shows an empty state with no reviews yet', async () => {
    mockApi(() => ({ body: { items: [], nextCursor: null } }));
    await renderWithProviders(<RangerReviewsScreen />);
    expect(await screen.findByText('No reviews yet.')).toBeTruthy();
  });

  it('shows the error state and can retry', async () => {
    mockApi(() => ({ status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }));
    await renderWithProviders(<RangerReviewsScreen />);
    expect(await screen.findByText('Could not load this. Check your connection.')).toBeTruthy();
  });
});
