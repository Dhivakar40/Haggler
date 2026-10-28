import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import {
  type MockCall,
  mockApi,
  renderWithProviders,
  routerMock,
  signInAs,
} from '../../test-utils';
import { WalletScreen } from './WalletScreen';

const PLANS = [
  {
    id: '11111111-aaaa-4aaa-8aaa-111111111111',
    slug: 'monthly',
    name: 'Monthly',
    audience: 'CUSTOMER',
    pricePaise: 9900,
    durationDays: 30,
    tokenDiscountBps: 0,
  },
];

// Schemas require real UUIDs for id fields; fabricate distinct-looking but valid ones.
const uuidN = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

/** D-106: the token balance/top-up endpoints are gone from this screen — it only reads Plus
 * membership/plans and order history now. */
function serve(over: { membership?: unknown; plans?: unknown[] } = {}) {
  const orders: {
    id: string;
    purpose: string;
    itemName: string;
    tokens: number | null;
    amountPaise: number;
    status: string;
    createdAt: string;
    paidAt: string | null;
  }[] = [];
  let n = 0;
  const api = mockApi((c: MockCall) => {
    if (c.method === 'GET' && c.path.startsWith('/v1/wallet/orders'))
      return { body: { items: orders, nextCursor: null } };
    if (c.method === 'GET' && c.path.startsWith('/v1/plus/plans'))
      return { body: over.plans ?? PLANS };
    if (c.method === 'GET' && c.path === '/v1/plus/membership')
      return { body: over.membership ?? null };
    if (c.method === 'POST' && c.path === '/v1/wallet/plus/subscribe') {
      const plan = PLANS.find((p) => p.id === (c.body as { planId: string }).planId)!;
      n += 1;
      const orderId = uuidN(n);
      orders.unshift({
        id: orderId,
        purpose: 'PLUS_SUBSCRIPTION',
        itemName: plan.name,
        tokens: null,
        amountPaise: plan.pricePaise,
        status: 'CREATED',
        createdAt: new Date().toISOString(),
        paidAt: null,
      });
      return {
        status: 201,
        body: {
          orderId,
          purpose: 'PLUS_SUBSCRIPTION',
          provider: 'sandbox',
          providerOrderId: `order_sandbox_${n}`,
          amountPaise: plan.pricePaise,
          tokens: null,
          keyId: null,
        },
      };
    }
    const payMatch = /\/v1\/wallet\/orders\/([0-9a-f-]+)\/sandbox-pay$/.exec(c.path);
    if (c.method === 'POST' && payMatch) {
      const order = orders.find((o) => o.id === payMatch[1])!;
      order.status = 'PAID';
      order.paidAt = new Date().toISOString();
      return { body: { ok: true } };
    }
    return undefined;
  });
  return { ...api };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs();
});

describe('WalletScreen (D-106: Haggler Plus only, token UI removed)', () => {
  it('lists the available Plus plans with price', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByTestId('plus-plan-monthly')).toHaveTextContent('₹99', {
      exact: false,
    });
  });

  it('shows active membership instead of plans when already subscribed', async () => {
    serve({
      membership: {
        planSlug: 'monthly',
        planName: 'Monthly',
        audience: 'CUSTOMER',
        tokenDiscountBps: 0,
        active: true,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByTestId('plus-active')).toHaveTextContent('Monthly is active', {
      exact: false,
    });
    expect(screen.queryByTestId('plus-plan-monthly')).toBeNull();
  });

  it('subscribing opens a sandbox checkout card with the right summary', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    await fireEvent.press(await screen.findByTestId('subscribe-monthly'));
    const checkout = await screen.findByTestId('checkout');
    expect(checkout).toHaveTextContent('Haggler Plus for ₹99', { exact: false });
    expect(screen.getByTestId('sandbox-pay')).toBeTruthy();
    expect(screen.queryByTestId('razorpay-pending')).toBeNull();
  });

  it('paying in sandbox closes checkout and refreshes history', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    await fireEvent.press(await screen.findByTestId('subscribe-monthly'));
    await screen.findByTestId('checkout');
    await fireEvent.press(screen.getByTestId('sandbox-pay'));
    await waitFor(() => expect(screen.queryByTestId('checkout')).toBeNull());
    expect(await screen.findByTestId(/^order-/)).toBeTruthy();
  });

  it('cancelling checkout dismisses it without paying', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    await fireEvent.press(await screen.findByTestId('subscribe-monthly'));
    await screen.findByTestId('checkout');
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByTestId('checkout')).toBeNull();
  });

  it('a failed subscribe request shows an error and no checkout card', async () => {
    mockApi((c) => {
      if (c.method === 'GET' && c.path.startsWith('/v1/wallet/orders'))
        return { body: { items: [], nextCursor: null } };
      if (c.method === 'GET' && c.path.startsWith('/v1/plus/plans')) return { body: PLANS };
      if (c.method === 'GET' && c.path === '/v1/plus/membership') return { body: null };
      if (c.method === 'POST' && c.path === '/v1/wallet/plus/subscribe')
        return { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } };
      return undefined;
    });
    await renderWithProviders(<WalletScreen />);
    await fireEvent.press(await screen.findByTestId('subscribe-monthly'));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByTestId('checkout')).toBeNull();
  });

  it('shows an empty state with no purchase history yet', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByText('No purchases yet.')).toBeTruthy();
  });

  it('an error loading Plus membership shows the error state, not a generic connection claim', async () => {
    mockApi((c) =>
      c.path === '/v1/plus/membership'
        ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }
        : { body: [] },
    );
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('going back uses the router', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    await fireEvent.press(await screen.findByText('Back'));
    expect(routerMock().back).toHaveBeenCalled();
  });

  it('is translated (Telugu)', async () => {
    await i18n.changeLanguage('te');
    serve();
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByText('హాగ్లర్ ప్లస్')).toBeTruthy();
  });
});
