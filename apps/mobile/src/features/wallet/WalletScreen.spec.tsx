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

const BUNDLES = [
  {
    id: '11111111-aaaa-4aaa-8aaa-111111111111',
    slug: 'starter-3',
    name: '3 tokens',
    tokens: 3,
    pricePaise: 4900,
  },
  {
    id: '22222222-bbbb-4bbb-8bbb-222222222222',
    slug: 'value-10',
    name: '10 tokens',
    tokens: 10,
    pricePaise: 14900,
  },
];

// Schemas require real UUIDs for id fields; fabricate distinct-looking but valid ones.
const uuidN = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

/** A wallet backend: tracks balance/held and a growing order list, all via the real endpoint shapes. */
function serve(over: { balanceTokens?: number; heldTokens?: number; membership?: unknown } = {}) {
  let balanceTokens = over.balanceTokens ?? 0;
  const heldTokens = over.heldTokens ?? 0;
  const ledger: {
    id: string;
    type: string;
    tokensDelta: number;
    jobId: null;
    note: null;
    createdAt: string;
  }[] = [];
  const orders: {
    id: string;
    purpose: string;
    itemName: string;
    tokens: number;
    amountPaise: number;
    status: string;
    createdAt: string;
    paidAt: string | null;
  }[] = [];
  let n = 0;
  const api = mockApi((c: MockCall) => {
    if (c.method === 'GET' && c.path === '/v1/wallet')
      return { body: { balanceTokens, heldTokens, recentLedger: ledger } };
    if (c.method === 'GET' && c.path === '/v1/wallet/bundles') return { body: BUNDLES };
    if (c.method === 'GET' && c.path.startsWith('/v1/wallet/orders'))
      return { body: { items: orders, nextCursor: null } };
    if (c.method === 'GET' && c.path.startsWith('/v1/plus/plans')) return { body: [] };
    if (c.method === 'GET' && c.path === '/v1/plus/membership')
      return { body: over.membership ?? null };
    if (c.method === 'POST' && c.path === '/v1/wallet/topup') {
      const bundle = BUNDLES.find((b) => b.id === (c.body as { bundleId: string }).bundleId)!;
      n += 1;
      const orderId = uuidN(n);
      orders.unshift({
        id: orderId,
        purpose: 'TOKEN_TOPUP',
        itemName: bundle.name,
        tokens: bundle.tokens,
        amountPaise: bundle.pricePaise,
        status: 'CREATED',
        createdAt: new Date().toISOString(),
        paidAt: null,
      });
      return {
        status: 201,
        body: {
          orderId,
          purpose: 'TOKEN_TOPUP',
          provider: 'sandbox',
          providerOrderId: `order_sandbox_${n}`,
          amountPaise: bundle.pricePaise,
          tokens: bundle.tokens,
          keyId: null,
        },
      };
    }
    const payMatch = /\/v1\/wallet\/orders\/([0-9a-f-]+)\/sandbox-pay$/.exec(c.path);
    if (c.method === 'POST' && payMatch) {
      const order = orders.find((o) => o.id === payMatch[1])!;
      order.status = 'PAID';
      order.paidAt = new Date().toISOString();
      balanceTokens += order.tokens;
      ledger.unshift({
        id: uuidN(1000 + n),
        type: 'PURCHASE',
        tokensDelta: order.tokens,
        jobId: null,
        note: null,
        createdAt: new Date().toISOString(),
      });
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

describe('WalletScreen', () => {
  it('shows the balance and, when nothing is held, no reservation note', async () => {
    serve({ balanceTokens: 7 });
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByTestId('balance-tokens')).toHaveTextContent('7 tokens');
    expect(screen.queryByTestId('held-tokens')).toBeNull();
  });

  it('shows held tokens when some are reserved for open jobs', async () => {
    serve({ balanceTokens: 4, heldTokens: 2 });
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByTestId('held-tokens')).toHaveTextContent(
      '2 tokens reserved for open jobs',
    );
  });

  it('singular wording for exactly one token', async () => {
    serve({ balanceTokens: 1, heldTokens: 1 });
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByTestId('balance-tokens')).toHaveTextContent('1 token');
    expect(screen.getByTestId('held-tokens')).toHaveTextContent('1 token reserved for an open job');
  });

  it('lists the available bundles with price', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByTestId('bundle-starter-3')).toHaveTextContent('₹49', {
      exact: false,
    });
    expect(screen.getByTestId('bundle-value-10')).toHaveTextContent('₹149', { exact: false });
  });

  it('buying opens a sandbox checkout card with the right summary', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    await fireEvent.press(await screen.findByTestId('buy-starter-3'));
    const checkout = await screen.findByTestId('checkout');
    expect(checkout).toHaveTextContent('3 tokens for ₹49', { exact: false });
    expect(screen.getByTestId('sandbox-pay')).toBeTruthy();
    expect(screen.queryByTestId('razorpay-pending')).toBeNull();
  });

  it('paying in sandbox credits the wallet, closes checkout, and refreshes history', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    await fireEvent.press(await screen.findByTestId('buy-value-10'));
    await screen.findByTestId('checkout');
    await fireEvent.press(screen.getByTestId('sandbox-pay'));
    await waitFor(() => expect(screen.queryByTestId('checkout')).toBeNull());
    expect(await screen.findByTestId('balance-tokens')).toHaveTextContent('10 tokens');
    expect(await screen.findByTestId(/^order-/)).toBeTruthy();
  });

  it('cancelling checkout dismisses it without paying', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    await fireEvent.press(await screen.findByTestId('buy-starter-3'));
    await screen.findByTestId('checkout');
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByTestId('checkout')).toBeNull();
    expect(screen.getByTestId('balance-tokens')).toHaveTextContent('0 tokens');
  });

  it('a failed top-up request shows an error and no checkout card', async () => {
    mockApi((c) => {
      if (c.method === 'GET' && c.path === '/v1/wallet')
        return { body: { balanceTokens: 0, heldTokens: 0, recentLedger: [] } };
      if (c.method === 'GET' && c.path === '/v1/wallet/bundles') return { body: BUNDLES };
      if (c.method === 'GET' && c.path.startsWith('/v1/wallet/orders'))
        return { body: { items: [], nextCursor: null } };
      if (c.method === 'GET' && c.path.startsWith('/v1/plus/plans')) return { body: [] };
      if (c.method === 'GET' && c.path === '/v1/plus/membership') return { body: null };
      if (c.method === 'POST' && c.path === '/v1/wallet/topup')
        return { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } };
      return undefined;
    });
    await renderWithProviders(<WalletScreen />);
    await fireEvent.press(await screen.findByTestId('buy-starter-3'));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByTestId('checkout')).toBeNull();
  });

  it('shows an empty state with no purchase history yet', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByText('No purchases yet.')).toBeTruthy();
  });

  it('an error loading the wallet shows the error state', async () => {
    mockApi((c) =>
      c.path === '/v1/wallet'
        ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }
        : { body: [] },
    );
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByText('Could not load this. Check your connection.')).toBeTruthy();
  });

  it('going back uses the router', async () => {
    serve();
    await renderWithProviders(<WalletScreen />);
    await fireEvent.press(await screen.findByText('Back'));
    expect(routerMock().back).toHaveBeenCalled();
  });

  it('is translated (Telugu)', async () => {
    await i18n.changeLanguage('te');
    serve({ balanceTokens: 3 });
    await renderWithProviders(<WalletScreen />);
    expect(await screen.findByText('వాలెట్')).toBeTruthy();
  });
});
