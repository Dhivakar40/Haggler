import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { PostListingScreen } from './PostListingScreen';

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

describe('PostListingScreen', () => {
  it('the submit button stays disabled until the required fields are valid', async () => {
    mockApi((c) => (c.path === '/v1/categories' ? { body: cats } : undefined));
    await renderWithProviders(<PostListingScreen />);
    await waitFor(() => expect(screen.getByTestId('listing-cat-electrician')).toBeTruthy());
    expect(screen.getByTestId('post-listing').props.accessibilityState?.disabled).toBe(true);
  });

  it('submits a valid listing and navigates to it', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/categories') return { body: cats };
      if (c.method === 'POST' && c.path === '/v1/employer/contracts')
        return {
          status: 201,
          body: {
            id: 'aaaaaaaa-1111-4111-8111-111111111111',
            employerId: 'bbbbbbbb-1111-4111-8111-111111111111',
            businessName: 'Acme',
            categorySlug: 'electrician',
            title: (c.body as { title: string }).title,
            description: (c.body as { description: string }).description,
            payType: 'DAILY',
            payAmountPaise: 150000,
            openings: 1,
            filledCount: 0,
            city: 'Chennai',
            state: 'Tamil Nadu',
            pincode: '600042',
            startDate: null,
            status: 'OPEN',
            isBoosted: false,
            createdAt: new Date().toISOString(),
          },
        };
      return undefined;
    });
    await renderWithProviders(<PostListingScreen />);
    await waitFor(() => expect(screen.getByTestId('listing-cat-electrician')).toBeTruthy());
    fireEvent.press(screen.getByTestId('listing-cat-electrician'));
    fireEvent.changeText(screen.getByTestId('listing-title'), 'Site electrician needed');
    fireEvent.changeText(
      screen.getByTestId('listing-description'),
      'Rewiring a 3-floor office building over two months.',
    );
    fireEvent.press(screen.getByTestId('pay-type-DAILY'));
    fireEvent.changeText(screen.getByTestId('listing-pay-amount'), '1500');
    fireEvent.changeText(screen.getByTestId('listing-openings'), '1');
    fireEvent.changeText(screen.getByTestId('listing-city'), 'Chennai');
    fireEvent.changeText(screen.getByTestId('listing-state'), 'Tamil Nadu');
    fireEvent.changeText(screen.getByTestId('listing-pincode'), '600042');

    await waitFor(() =>
      expect(screen.getByTestId('post-listing').props.accessibilityState?.disabled).toBe(false),
    );
    fireEvent.press(screen.getByTestId('post-listing'));

    await waitFor(() =>
      expect(routerMock().replace).toHaveBeenCalledWith(
        '/employer/listings/aaaaaaaa-1111-4111-8111-111111111111',
      ),
    );
    const postCall = calls.find((c) => c.path === '/v1/employer/contracts');
    expect(postCall?.body).toMatchObject({
      categorySlug: 'electrician',
      payAmountPaise: 150000,
      openings: 1,
      pincode: '600042',
    });
  });
});
