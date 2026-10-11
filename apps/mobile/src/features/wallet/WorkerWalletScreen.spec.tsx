import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import i18n from '../../i18n';
import { type MockCall, mockApi, renderWithProviders, routerMock, signInAs } from '../../test-utils';
import { WorkerWalletScreen } from './WorkerWalletScreen';

interface LedgerEntry {
  id: string;
  type: string;
  amountPaise: number;
  jobId: null;
  note: null;
  createdAt: string;
}

// Schemas require real UUIDs for id fields; fabricate distinct-looking but valid ones.
const uuidN = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

/** A worker-wallet backend: tracks balance/dues and a ledger, via the real endpoint shapes. */
function serve(over: { balancePaise?: number; duesPaise?: number } = {}) {
  let balancePaise = over.balancePaise ?? 0;
  let duesPaise = over.duesPaise ?? 0;
  const ledger: LedgerEntry[] = [];
  const api = mockApi((c: MockCall) => {
    if (c.method === 'GET' && c.path === '/v1/worker/wallet')
      return { body: { balancePaise, duesPaise, recentLedger: ledger } };
    if (c.method === 'POST' && c.path === '/v1/worker/wallet/dues/settle') {
      const amount = Math.min((c.body as { amountPaise: number }).amountPaise, duesPaise);
      duesPaise -= amount;
      ledger.unshift({
        id: uuidN(ledger.length + 1),
        type: 'DUES_SETTLED',
        amountPaise: -amount,
        jobId: null,
        note: null,
        createdAt: new Date().toISOString(),
      });
      return { body: { settledPaise: amount } };
    }
    if (c.method === 'POST' && c.path === '/v1/worker/wallet/withdraw') {
      const amount = (c.body as { amountPaise: number }).amountPaise;
      if (amount > balancePaise) return { status: 422, body: { error: { details: {} } } };
      balancePaise -= amount;
      ledger.unshift({
        id: uuidN(ledger.length + 1),
        type: 'WITHDRAWAL',
        amountPaise: -amount,
        jobId: null,
        note: null,
        createdAt: new Date().toISOString(),
      });
      return { body: { withdrawnPaise: amount } };
    }
    return undefined;
  });
  return api;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  signInAs({ roles: ['CUSTOMER', 'WORKER'] });
});

describe('WorkerWalletScreen', () => {
  it('shows the available balance', async () => {
    serve({ balancePaise: 150000 });
    await renderWithProviders(<WorkerWalletScreen />);
    expect(await screen.findByTestId('balance-paise')).toHaveTextContent('₹1,500');
  });

  it('shows dues owed and a warning only when there are dues', async () => {
    serve({ balancePaise: 0, duesPaise: 0 });
    await renderWithProviders(<WorkerWalletScreen />);
    await screen.findByTestId('balance-paise');
    expect(screen.queryByTestId('worker-dues')).toBeNull();
  });

  it('settles dues for the amount entered, prefilled with what is owed', async () => {
    const { calls } = serve({ balancePaise: 0, duesPaise: 20000 });
    await renderWithProviders(<WorkerWalletScreen />);
    expect(await screen.findByTestId('dues-paise')).toHaveTextContent('₹200');
    await fireEvent.press(screen.getByTestId('open-settle-dues'));
    expect(screen.getByTestId('worker-wallet-amount').props.value).toBe('200');
    await fireEvent.press(screen.getByTestId('worker-wallet-submit'));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/v1/worker/wallet/dues/settle')?.body,
      ).toEqual({ amountPaise: 20000 }),
    );
    await waitFor(() => expect(screen.queryByTestId('worker-dues')).toBeNull());
  });

  it('withdraws for the amount entered, prefilled with the available balance', async () => {
    const { calls } = serve({ balancePaise: 50000, duesPaise: 0 });
    await renderWithProviders(<WorkerWalletScreen />);
    await screen.findByTestId('balance-paise');
    await fireEvent.press(screen.getByTestId('open-withdraw'));
    expect(screen.getByTestId('worker-wallet-amount').props.value).toBe('500');
    await fireEvent.press(screen.getByTestId('worker-wallet-submit'));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/v1/worker/wallet/withdraw')?.body,
      ).toEqual({ amountPaise: 50000 }),
    );
  });

  it('rejects an invalid amount without calling the server', async () => {
    const { calls } = serve({ balancePaise: 50000 });
    await renderWithProviders(<WorkerWalletScreen />);
    await fireEvent.press(await screen.findByTestId('open-withdraw'));
    await fireEvent.changeText(screen.getByTestId('worker-wallet-amount'), 'abc');
    await fireEvent.press(screen.getByTestId('worker-wallet-submit'));
    expect(await screen.findByText('Enter a valid amount in rupees.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')).toBeUndefined();
  });

  it('shows recent ledger activity', async () => {
    serve({ balancePaise: 50000, duesPaise: 10000 });
    await renderWithProviders(<WorkerWalletScreen />);
    await fireEvent.press(await screen.findByTestId('open-settle-dues'));
    await fireEvent.press(screen.getByTestId('worker-wallet-submit'));
    expect(await screen.findByText('Dues settled')).toBeTruthy();
  });

  it('goes back', async () => {
    serve({ balancePaise: 0 });
    await renderWithProviders(<WorkerWalletScreen />);
    await fireEvent.press(await screen.findByText('Back'));
    expect(routerMock().back).toHaveBeenCalled();
  });
});
