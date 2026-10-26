import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { StudentProfileScreen } from './StudentProfileScreen';

const FULL_PROFILE = {
  instituteName: 'Anna University',
  courseOfStudy: null,
  yearOfStudy: null,
  skills: [] as string[],
  availabilityHoursPerWeek: null,
  bio: null,
  portfolioUrl: null,
};

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
    await waitFor(() => expect(screen.getByTestId('student-dob-day')).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId('student-dob-day')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('student-dob-day'), '01');
    await fireEvent.changeText(screen.getByTestId('student-dob-month'), '01');
    await fireEvent.changeText(screen.getByTestId('student-dob-year'), '2015');
    await fireEvent.press(screen.getByTestId('student-save-profile'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You must be 18 or older to use Campus.'),
    );
  });

  it('(D-103) shows the full editable profile once a profile exists, not a thin read-only summary', async () => {
    mockApi((c) =>
      c.path === '/v1/student/profile' && c.method === 'GET' ? { body: FULL_PROFILE } : undefined,
    );
    await renderWithProviders(<StudentProfileScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('student-institute').props.value).toBe('Anna University'),
    );
    expect(screen.queryByTestId('student-dob-day')).toBeNull(); // the DOB cannot be edited here
    expect(screen.getByTestId('student-course')).toBeTruthy();
    expect(screen.getByTestId('student-hours')).toBeTruthy();
    expect(screen.getByTestId('student-bio')).toBeTruthy();
    expect(screen.getByTestId('student-portfolio')).toBeTruthy();
  });

  it('(D-103) picks a year of study, adds skills, sets availability, and saves all of it together', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/student/profile' && c.method === 'GET') return { body: FULL_PROFILE };
      if (c.path === '/v1/student/profile' && c.method === 'PATCH')
        return { body: { ...FULL_PROFILE, ...(c.body as object) } };
    });
    await renderWithProviders(<StudentProfileScreen />);
    await screen.findByTestId('student-institute');

    await fireEvent.changeText(screen.getByTestId('student-course'), 'B.Tech Computer Science');
    await fireEvent.press(screen.getByTestId('student-year-YEAR_3'));
    expect(screen.getByTestId('student-year-YEAR_3').props.accessibilityState.selected).toBe(
      true,
    );

    await fireEvent.changeText(screen.getByTestId('student-skill-input'), 'Excel');
    await fireEvent.press(screen.getByTestId('student-add-skill'));
    expect(screen.getByTestId('student-skill-Excel')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('student-hours'), '15');
    await fireEvent.changeText(
      screen.getByTestId('student-bio'),
      'Looking for part-time design work.',
    );
    await fireEvent.changeText(screen.getByTestId('student-portfolio'), 'https://example.com/me');

    await fireEvent.press(screen.getByTestId('student-save-details'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      instituteName: 'Anna University',
      courseOfStudy: 'B.Tech Computer Science',
      yearOfStudy: 'YEAR_3',
      skills: ['Excel'],
      availabilityHoursPerWeek: 15,
      bio: 'Looking for part-time design work.',
      portfolioUrl: 'https://example.com/me',
    });
  });

  it('(D-103) a skill can be removed by tapping its chip', async () => {
    mockApi((c) =>
      c.path === '/v1/student/profile' && c.method === 'GET'
        ? { body: { ...FULL_PROFILE, skills: ['Excel', 'Figma'] } }
        : undefined,
    );
    await renderWithProviders(<StudentProfileScreen />);
    await screen.findByTestId('student-skill-Excel');
    await fireEvent.press(screen.getByTestId('student-skill-Excel'));
    expect(screen.queryByTestId('student-skill-Excel')).toBeNull();
    expect(screen.getByTestId('student-skill-Figma')).toBeTruthy();
  });

  it('(D-103) rejects a portfolio link that is not a real URL, client-side', async () => {
    const { calls } = mockApi((c) =>
      c.path === '/v1/student/profile' && c.method === 'GET' ? { body: FULL_PROFILE } : undefined,
    );
    await renderWithProviders(<StudentProfileScreen />);
    await screen.findByTestId('student-portfolio');
    await fireEvent.changeText(screen.getByTestId('student-portfolio'), 'not-a-link');
    await fireEvent.press(screen.getByTestId('student-save-details'));
    expect(
      await screen.findByText('Enter a valid link starting with http:// or https://.'),
    ).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('saves a valid date of birth and navigates to Campus', async () => {
    let created = false;
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/student/profile' && c.method === 'GET')
        return created
          ? { body: { ...FULL_PROFILE, instituteName: 'IIT Madras' } }
          : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not found' } } };
      if (c.path === '/v1/student/profile' && c.method === 'POST') {
        created = true;
        return { status: 201, body: { ...FULL_PROFILE, instituteName: 'IIT Madras' } };
      }
      return undefined;
    });
    await renderWithProviders(<StudentProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('student-dob-day')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('student-dob-day'), '15');
    await fireEvent.changeText(screen.getByTestId('student-dob-month'), '06');
    await fireEvent.changeText(screen.getByTestId('student-dob-year'), '2003');
    await fireEvent.changeText(screen.getByTestId('student-institute'), 'IIT Madras');
    await fireEvent.press(screen.getByTestId('student-save-profile'));
    await waitFor(() => expect(routerMock().push).toHaveBeenCalledWith('/campus'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      dateOfBirth: '2003-06-15',
      instituteName: 'IIT Madras',
    });
  });
});
