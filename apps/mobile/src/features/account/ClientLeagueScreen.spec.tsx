import { screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { ClientLeagueScreen } from './ClientLeagueScreen';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  signInAs();
});

const ladder = (reachedUpTo: number) =>
  [
    'NEWCOMER',
    'REGULAR',
    'PREFERRED',
    'TRUSTED',
    'LOYAL',
    'ELITE',
    'CHAMPION',
    'PATRON',
    'LEGEND',
  ].map((tier, i) => ({ tier, reached: i <= reachedUpTo }));

describe('ClientLeagueScreen', () => {
  it('shows the current league, progress, and the next league it is heading toward', async () => {
    mockApi((c) =>
      c.path === '/v1/me/league'
        ? {
            body: {
              league: 'TRUSTED',
              nextLeague: 'LOYAL',
              progress: 0.5,
              bookingsCompleted: 3,
              ratingAvg: 4.0,
              ratingCount: 2,
              cancellationRate: 0,
              ladder: ladder(3),
            },
          }
        : undefined,
    );
    await renderWithProviders(<ClientLeagueScreen />);
    expect(await screen.findByTestId('client-league-name')).toHaveTextContent('Trusted');
    expect(screen.getByTestId('client-league-progress-label')).toHaveTextContent(
      '50% of the way to Loyal',
    );
    expect(screen.getByTestId('client-league-stats')).toHaveTextContent('3 bookings completed', {
      exact: false,
    });
  });

  it('shows the full ladder, marking which leagues are reached', async () => {
    mockApi((c) =>
      c.path === '/v1/me/league'
        ? {
            body: {
              league: 'PREFERRED',
              nextLeague: 'TRUSTED',
              progress: 0.2,
              bookingsCompleted: 2,
              ratingAvg: 3.0,
              ratingCount: 1,
              cancellationRate: 0,
              ladder: ladder(2),
            },
          }
        : undefined,
    );
    await renderWithProviders(<ClientLeagueScreen />);
    await waitFor(() => expect(screen.getByTestId('client-ladder-NEWCOMER')).toBeTruthy());
    expect(screen.getByTestId('client-ladder-PREFERRED')).toHaveTextContent('you are here', {
      exact: false,
    });
    expect(screen.getByTestId('client-ladder-LEGEND')).not.toHaveTextContent('you are here', {
      exact: false,
    });
  });

  it('celebrates reaching the top league instead of showing a progress bar to nowhere', async () => {
    mockApi((c) =>
      c.path === '/v1/me/league'
        ? {
            body: {
              league: 'LEGEND',
              nextLeague: null,
              progress: 1,
              bookingsCompleted: 120,
              ratingAvg: 4.9,
              ratingCount: 30,
              cancellationRate: 0.01,
              ladder: ladder(8),
            },
          }
        : undefined,
    );
    await renderWithProviders(<ClientLeagueScreen />);
    expect(await screen.findByText("You've reached the top league.")).toBeTruthy();
    expect(screen.queryByTestId('client-league-progress-bar')).toBeNull();
  });
});
