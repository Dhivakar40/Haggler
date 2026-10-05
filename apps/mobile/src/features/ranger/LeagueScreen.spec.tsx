import { screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { LeagueScreen } from './LeagueScreen';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  signInAs();
});

const ladder = (reachedUpTo: number) =>
  ['WOOD', 'STONE', 'COPPER', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'LEGENDARY'].map(
    (tier, i) => ({ tier, reached: i <= reachedUpTo }),
  );

describe('LeagueScreen', () => {
  it('shows the current league, progress, and the next league it is heading toward', async () => {
    mockApi((c) =>
      c.path === '/v1/worker/league'
        ? {
            body: {
              league: 'SILVER',
              nextLeague: 'GOLD',
              progress: 0.4,
              jobsCompleted: 16,
              ratingAvg: 4.6,
              ratingCount: 9,
              cancellationRate: 0,
              ladder: ladder(4),
            },
          }
        : undefined,
    );
    await renderWithProviders(<LeagueScreen />);
    expect(await screen.findByTestId('league-name')).toHaveTextContent('Silver');
    expect(screen.getByTestId('league-progress-label')).toHaveTextContent('40% of the way to Gold');
    expect(screen.getByTestId('league-stats')).toHaveTextContent('16 jobs completed', {
      exact: false,
    });
    expect(screen.getByTestId('league-stats')).toHaveTextContent(
      '4.6 average rating (9 ratings)',
      { exact: false },
    );
  });

  it('shows the full ladder, marking which leagues are reached', async () => {
    mockApi((c) =>
      c.path === '/v1/worker/league'
        ? {
            body: {
              league: 'BRONZE',
              nextLeague: 'SILVER',
              progress: 0.1,
              jobsCompleted: 10,
              ratingAvg: 4.1,
              ratingCount: 3,
              cancellationRate: 0,
              ladder: ladder(3),
            },
          }
        : undefined,
    );
    await renderWithProviders(<LeagueScreen />);
    await waitFor(() => expect(screen.getByTestId('ladder-WOOD')).toBeTruthy());
    expect(screen.getByTestId('ladder-BRONZE')).toHaveTextContent('you are here', {
      exact: false,
    });
    expect(screen.getByTestId('ladder-LEGENDARY')).not.toHaveTextContent('you are here', {
      exact: false,
    });
  });

  it('celebrates reaching the top league instead of showing a progress bar to nowhere', async () => {
    mockApi((c) =>
      c.path === '/v1/worker/league'
        ? {
            body: {
              league: 'LEGENDARY',
              nextLeague: null,
              progress: 1,
              jobsCompleted: 400,
              ratingAvg: 4.95,
              ratingCount: 120,
              cancellationRate: 0.01,
              ladder: ladder(8),
            },
          }
        : undefined,
    );
    await renderWithProviders(<LeagueScreen />);
    expect(await screen.findByText("You've reached the top league.")).toBeTruthy();
    expect(screen.queryByTestId('league-progress-bar')).toBeNull();
  });

  it('shows no-ratings-yet for a brand-new Ranger instead of claiming a 0-star average', async () => {
    mockApi((c) =>
      c.path === '/v1/worker/league'
        ? {
            body: {
              league: 'WOOD',
              nextLeague: 'STONE',
              progress: 0,
              jobsCompleted: 0,
              ratingAvg: null,
              ratingCount: 0,
              cancellationRate: 0,
              ladder: ladder(0),
            },
          }
        : undefined,
    );
    await renderWithProviders(<LeagueScreen />);
    expect(await screen.findByText('No ratings yet')).toBeTruthy();
  });
});
