import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { PostCampusListingScreen } from './PostCampusListingScreen';

const cats = [
  {
    id: '00000000-0000-4000-8000-000000000000',
    slug: 'electrician',
    nameKey: 'categories.electrician',
    icon: 'flash',
    requiresLicense: false,
  },
];

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'EMPLOYER'] });
});

describe('PostCampusListingScreen', () => {
  it('the submit button stays disabled until the required fields are valid', async () => {
    mockApi((c) => (c.path === '/v1/categories' ? { body: cats } : undefined));
    await renderWithProviders(<PostCampusListingScreen />);
    await waitFor(() => expect(screen.getByTestId('campus-cat-electrician')).toBeTruthy());
    expect(screen.getByTestId('post-campus-listing').props.accessibilityState?.disabled).toBe(true);
  });

  it('submits a valid listing (including night-shift choice) and navigates to it', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/categories') return { body: cats };
      if (c.method === 'POST' && c.path === '/v1/employer/campus')
        return {
          status: 201,
          body: {
            id: 'aaaaaaaa-1111-4111-8111-111111111111',
            employerId: 'bbbbbbbb-1111-4111-8111-111111111111',
            businessName: 'Acme',
            categorySlug: 'electrician',
            title: (c.body as { title: string }).title,
            description: (c.body as { description: string }).description,
            hourlyRatePaise: 15000,
            hoursPerWeek: 12,
            isNightShift: true,
            openings: 1,
            filledCount: 0,
            city: 'Chennai',
            state: 'Tamil Nadu',
            pincode: '600042',
            status: 'OPEN',
            isBoosted: false,
            createdAt: new Date().toISOString(),
          },
        };
      return undefined;
    });
    await renderWithProviders(<PostCampusListingScreen />);
    await waitFor(() => expect(screen.getByTestId('campus-cat-electrician')).toBeTruthy());
    fireEvent.press(screen.getByTestId('campus-cat-electrician'));
    fireEvent.changeText(screen.getByTestId('campus-title'), 'Front-desk help, evenings');
    fireEvent.changeText(
      screen.getByTestId('campus-description'),
      'Answering phones at our tutoring centre in the evenings.',
    );
    fireEvent.changeText(screen.getByTestId('campus-hourly-rate'), '150');
    fireEvent.changeText(screen.getByTestId('campus-hours-per-week'), '12');
    fireEvent.press(screen.getByTestId('shift-night'));
    fireEvent.changeText(screen.getByTestId('campus-openings'), '1');
    fireEvent.changeText(screen.getByTestId('campus-city'), 'Chennai');
    fireEvent.changeText(screen.getByTestId('campus-state'), 'Tamil Nadu');
    fireEvent.changeText(screen.getByTestId('campus-pincode'), '600042');

    await waitFor(() =>
      expect(screen.getByTestId('post-campus-listing').props.accessibilityState?.disabled).toBe(
        false,
      ),
    );
    fireEvent.press(screen.getByTestId('post-campus-listing'));

    await waitFor(() =>
      expect(routerMock().replace).toHaveBeenCalledWith(
        '/employer/campus/aaaaaaaa-1111-4111-8111-111111111111',
      ),
    );
    const postCall = calls.find((c) => c.path === '/v1/employer/campus');
    expect(postCall?.body).toMatchObject({
      categorySlug: 'electrician',
      hourlyRatePaise: 15000,
      hoursPerWeek: 12,
      isNightShift: true,
      pincode: '600042',
    });
  });
});
