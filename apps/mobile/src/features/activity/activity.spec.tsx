import { fireEvent, screen } from '@testing-library/react-native';
import i18n from '../../i18n';
import { makeJob, mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { ActivityScreen } from './ActivityScreen';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER'] });
});

describe('ActivityScreen', () => {
  it('shows an empty state when there is nothing yet', async () => {
    mockApi((c) =>
      c.path.startsWith('/v1/jobs') ? { body: { items: [], nextCursor: null } } : undefined,
    );
    await renderWithProviders(<ActivityScreen />);
    expect(await screen.findByText('No jobs yet.')).toBeTruthy();
  });

  it('shows an error state and can retry', async () => {
    let calls = 0;
    mockApi((c) => {
      if (!c.path.startsWith('/v1/jobs')) return undefined;
      calls += 1;
      return calls === 1
        ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }
        : { body: { items: [], nextCursor: null } };
    });
    await renderWithProviders(<ActivityScreen />);
    await fireEvent.press(await screen.findByLabelText('Try again'));
    expect(await screen.findByText('No jobs yet.')).toBeTruthy();
  });

  it('lists jobs with category, description, status and price, and opens one on tap', async () => {
    const J1 = '11111111-aaaa-4aaa-8aaa-111111111111';
    const J2 = '22222222-bbbb-4bbb-8bbb-222222222222';
    const jobs = [
      makeJob({
        id: J1,
        categorySlug: 'plumber',
        description: 'Kitchen tap leak',
        status: 'IN_PROGRESS',
        agreedPricePaise: 55000,
      }),
      makeJob({
        id: J2,
        categorySlug: 'electrician',
        description: 'Fan repair',
        status: 'BROADCASTING',
        agreedPricePaise: null,
      }),
    ];
    mockApi((c) =>
      c.path.startsWith('/v1/jobs') ? { body: { items: jobs, nextCursor: null } } : undefined,
    );
    await renderWithProviders(<ActivityScreen />);
    expect(await screen.findByTestId(`job-${J1}`)).toHaveTextContent('Kitchen tap leak', {
      exact: false,
    });
    expect(screen.getByTestId(`job-${J1}`)).toHaveTextContent('₹550', { exact: false });
    expect(screen.getByTestId(`job-${J2}`)).toHaveTextContent('Looking for a Ranger', {
      exact: false,
    });
    await fireEvent.press(screen.getByTestId(`job-${J1}`));
    expect(routerMock().push).toHaveBeenCalledWith({ pathname: '/job/[id]', params: { id: J1 } });
  });

  it('a customer never sees the customer/Ranger toggle', async () => {
    mockApi(() => ({ body: { items: [], nextCursor: null } }));
    await renderWithProviders(<ActivityScreen />);
    await screen.findByText('No jobs yet.');
    expect(screen.queryByTestId('role-ranger')).toBeNull();
  });

  it('a Ranger can switch between their customer requests and their Ranger jobs', async () => {
    signInAs({ roles: ['CUSTOMER', 'WORKER'], workerKycTier: 2 });
    const C1 = '33333333-cccc-4ccc-8ccc-333333333333';
    const W1 = '44444444-dddd-4ddd-8ddd-444444444444';
    const { calls } = mockApi((c) => {
      if (!c.path.startsWith('/v1/jobs')) return undefined;
      const asWorker = c.path.includes('role=WORKER');
      return {
        body: {
          items: [
            makeJob({ id: asWorker ? W1 : C1, viewerRole: asWorker ? 'WORKER' : 'CUSTOMER' }),
          ],
          nextCursor: null,
        },
      };
    });
    await renderWithProviders(<ActivityScreen />);
    expect(await screen.findByTestId(`job-${C1}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('role-ranger'));
    expect(await screen.findByTestId(`job-${W1}`)).toBeTruthy();
    expect(screen.queryByTestId(`job-${C1}`)).toBeNull();
    expect(calls.some((c) => c.path.includes('role=WORKER'))).toBe(true);
  });

  it('is translated (Kannada)', async () => {
    await i18n.changeLanguage('kn');
    mockApi(() => ({ body: { items: [], nextCursor: null } }));
    await renderWithProviders(<ActivityScreen />);
    expect(await screen.findByText('ಇನ್ನೂ ಕೆಲಸಗಳಿಲ್ಲ.')).toBeTruthy();
  });
});
