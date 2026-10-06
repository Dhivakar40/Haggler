import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders, routerMock } from '../test-utils';
import { useLeagueUpQueue } from '../store/league-up-queue';
import { LeagueUpModal } from './LeagueUpModal';

beforeEach(() => {
  useLeagueUpQueue.setState({ queue: [] });
});

describe('LeagueUpModal', () => {
  it('renders nothing when the queue is empty', async () => {
    await renderWithProviders(<LeagueUpModal />);
    expect(screen.queryByTestId('league-up-modal')).toBeNull();
  });

  it('shows the worker league reached, and dismiss advances to the next queued event', async () => {
    useLeagueUpQueue.setState({
      queue: [
        { kind: 'worker', league: 'STONE' },
        { kind: 'client', league: 'PREFERRED' },
      ],
    });
    await renderWithProviders(<LeagueUpModal />);
    expect(screen.getByTestId('league-up-body')).toHaveTextContent("You've reached Stone league.");

    await fireEvent.press(screen.getByTestId('league-up-dismiss'));
    expect(screen.getByTestId('league-up-body')).toHaveTextContent(
      "You've reached Preferred status.",
    );
    expect(useLeagueUpQueue.getState().queue).toHaveLength(1);
  });

  it('"View my league" navigates to the right screen for the kind and clears the event', async () => {
    useLeagueUpQueue.setState({ queue: [{ kind: 'worker', league: 'COPPER' }] });
    await renderWithProviders(<LeagueUpModal />);
    await fireEvent.press(screen.getByTestId('league-up-view'));
    expect(routerMock().push).toHaveBeenCalledWith('/league');
    expect(useLeagueUpQueue.getState().queue).toHaveLength(0);
  });

  it('a client league-up routes to /client-league', async () => {
    useLeagueUpQueue.setState({ queue: [{ kind: 'client', league: 'TRUSTED' }] });
    await renderWithProviders(<LeagueUpModal />);
    await fireEvent.press(screen.getByTestId('league-up-view'));
    expect(routerMock().push).toHaveBeenCalledWith('/client-league');
  });
});
