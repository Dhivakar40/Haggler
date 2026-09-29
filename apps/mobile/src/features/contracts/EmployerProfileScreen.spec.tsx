import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { EmployerProfileScreen } from './EmployerProfileScreen';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'EMPLOYER'] });
});

describe('EmployerProfileScreen', () => {
  it('starts empty when no profile exists yet (404)', async () => {
    mockApi((c) =>
      c.path === '/v1/employer/profile' && c.method === 'GET'
        ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not found' } } }
        : undefined,
    );
    await renderWithProviders(<EmployerProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('employer-business-name')).toBeTruthy());
    expect(screen.getByTestId('employer-business-name').props.value).toBe('');
  });

  it('saves a business name and navigates to my listings', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/employer/profile' && c.method === 'GET')
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not found' } } };
      if (c.path === '/v1/employer/profile' && c.method === 'PATCH')
        return { body: { businessName: (c.body as { businessName: string }).businessName } };
      return undefined;
    });
    await renderWithProviders(<EmployerProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('employer-business-name')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('employer-business-name'), 'Acme Renovations');
    await waitFor(() =>
      expect(screen.getByTestId('employer-save-profile').props.accessibilityState?.disabled).toBe(
        false,
      ),
    );
    fireEvent.press(screen.getByTestId('employer-save-profile'));
    await waitFor(() => expect(routerMock().push).toHaveBeenCalledWith('/employer/listings'));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      businessName: 'Acme Renovations',
    });
  });
});
