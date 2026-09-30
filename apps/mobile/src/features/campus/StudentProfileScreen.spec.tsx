import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { StudentProfileScreen } from './StudentProfileScreen';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'STUDENT'] });
});

describe('StudentProfileScreen', () => {
  it('shows the date-of-birth form when no profile exists yet (404)', async () => {
    mockApi((c) =>
      c.path === '/v1/student/profile' && c.method === 'GET'
        ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not found' } } }
        : undefined,
    );
    await renderWithProviders(<StudentProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('student-dob')).toBeTruthy());
    expect(screen.getByTestId('student-save-profile').props.accessibilityState?.disabled).toBe(
      true,
    );
  });

  it('shows a server refusal (under 18) as an error, not a crash', async () => {
    mockApi((c) => {
      if (c.path === '/v1/student/profile' && c.method === 'GET')
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not found' } } };
      if (c.path === '/v1/student/profile' && c.method === 'POST')
        return {
          status: 422,
          body: {
            error: {
              code: 'UNPROCESSABLE',
              message: 'You must be 18 or older to use Campus.',
              details: { code: 'UNDER_18' },
            },
          },
        };
      return undefined;
    });
    await renderWithProviders(<StudentProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('student-dob')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('student-dob'), '2015-01-01');
    await waitFor(() =>
      expect(screen.getByTestId('student-save-profile').props.accessibilityState?.disabled).toBe(
        false,
      ),
    );
    fireEvent.press(screen.getByTestId('student-save-profile'));
    await waitFor(() => expect(screen.getByText(/18 or older/)).toBeTruthy());
  });

  it('shows a read-only summary once a profile exists', async () => {
    mockApi((c) =>
      c.path === '/v1/student/profile' && c.method === 'GET'
        ? { body: { instituteName: 'Anna University' } }
        : undefined,
    );
    await renderWithProviders(<StudentProfileScreen />);
    await waitFor(() => expect(screen.getByText('Anna University')).toBeTruthy());
    expect(screen.queryByTestId('student-dob')).toBeNull();
  });

  // Kept last: this is the only test whose component keeps re-rendering from a background
  // query-invalidation cycle right up to the end (save() awaits invalidateQueries(), which
  // awaits a GET refetch), which was observed to bleed into a following test's render
  // (overlapping act() calls, next test's tree coming back empty) even after explicitly
  // awaiting that cycle to settle and unmounting. Ordering it last sidesteps that rather than
  // relying on a fix that didn't hold up under investigation.
  it('saves a valid date of birth and navigates to Campus', async () => {
    let created = false;
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/student/profile' && c.method === 'GET')
        return created
          ? { body: { instituteName: 'IIT Madras' } }
          : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not found' } } };
      if (c.path === '/v1/student/profile' && c.method === 'POST') {
        created = true;
        return { status: 201, body: { instituteName: 'IIT Madras' } };
      }
      return undefined;
    });
    await renderWithProviders(<StudentProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('student-dob')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('student-dob'), '2003-06-15');
    fireEvent.changeText(screen.getByTestId('student-institute'), 'IIT Madras');
    await waitFor(() =>
      expect(screen.getByTestId('student-save-profile').props.accessibilityState?.disabled).toBe(
        false,
      ),
    );
    fireEvent.press(screen.getByTestId('student-save-profile'));
    await waitFor(() => expect(screen.getByText('IIT Madras')).toBeTruthy());
    expect(routerMock().push).toHaveBeenCalledWith('/campus');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      dateOfBirth: '2003-06-15',
      instituteName: 'IIT Madras',
    });
  });
});
