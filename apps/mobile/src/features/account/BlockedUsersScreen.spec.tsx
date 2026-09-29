import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { BlockedUsersScreen } from './BlockedUsersScreen';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs();
});

describe('BlockedUsersScreen', () => {
  it('shows an empty state with nobody blocked', async () => {
    mockApi((c) => (c.path === '/v1/me/blocks' ? { body: [] } : undefined));
    await renderWithProviders(<BlockedUsersScreen />);
    expect(await screen.findByText("You haven't blocked anyone.")).toBeTruthy();
  });

  it('lists blocked users with their reason, and unblocks one', async () => {
    let blocked = [
      {
        userId: 'aaaaaaaa-1111-4111-8111-111111111111',
        firstName: 'Ravi',
        reason: 'Rude in chat',
        createdAt: new Date().toISOString(),
      },
    ];
    const { calls } = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/v1/me/blocks') return { body: blocked };
      if (
        c.method === 'DELETE' &&
        c.path === '/v1/me/blocks/aaaaaaaa-1111-4111-8111-111111111111'
      ) {
        blocked = [];
        return { body: { blocked: false } };
      }
      return undefined;
    });
    await renderWithProviders(<BlockedUsersScreen />);
    expect(
      await screen.findByTestId('blocked-aaaaaaaa-1111-4111-8111-111111111111'),
    ).toHaveTextContent('Ravi', { exact: false });
    expect(screen.getByTestId('blocked-aaaaaaaa-1111-4111-8111-111111111111')).toHaveTextContent(
      'Rude in chat',
      { exact: false },
    );
    await fireEvent.press(screen.getByTestId('unblock-aaaaaaaa-1111-4111-8111-111111111111'));
    await waitFor(() =>
      expect(screen.queryByTestId('blocked-aaaaaaaa-1111-4111-8111-111111111111')).toBeNull(),
    );
    expect(
      calls.some(
        (c) =>
          c.method === 'DELETE' && c.path === '/v1/me/blocks/aaaaaaaa-1111-4111-8111-111111111111',
      ),
    ).toBe(true);
    expect(await screen.findByText("You haven't blocked anyone.")).toBeTruthy();
  });

  it('a failed unblock shows an error and keeps the entry', async () => {
    mockApi((c) => {
      if (c.method === 'GET' && c.path === '/v1/me/blocks')
        return {
          body: [
            {
              userId: 'aaaaaaaa-1111-4111-8111-111111111111',
              firstName: 'Ravi',
              reason: null,
              createdAt: new Date().toISOString(),
            },
          ],
        };
      if (c.method === 'DELETE')
        return { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } };
      return undefined;
    });
    await renderWithProviders(<BlockedUsersScreen />);
    await fireEvent.press(
      await screen.findByTestId('unblock-aaaaaaaa-1111-4111-8111-111111111111'),
    );
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.getByTestId('blocked-aaaaaaaa-1111-4111-8111-111111111111')).toBeTruthy();
  });

  it('shows the error state and can retry', async () => {
    mockApi(() => ({ status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }));
    await renderWithProviders(<BlockedUsersScreen />);
    expect(await screen.findByText('Could not load this. Check your connection.')).toBeTruthy();
  });
});
