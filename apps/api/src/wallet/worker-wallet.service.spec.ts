import { WorkerWalletService } from './worker-wallet.service';
import type { PrismaService } from '../prisma/prisma.service';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WALLET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('WorkerWalletService (Phase Commerce B3/B4/B6)', () => {
  it('summary() returns zeroes for a Ranger with no wallet row yet', async () => {
    const prisma = {
      workerWallet: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const svc = new WorkerWalletService(prisma);
    const s = await svc.summary(USER_ID);
    expect(s).toEqual({ balancePaise: 0, duesPaise: 0, recentLedger: [] });
  });

  it('duesBlocked() is true once dues reach the threshold, false below it', async () => {
    const prisma = {
      workerWallet: { findUnique: jest.fn().mockResolvedValue({ duesPaise: 50_000 }) },
    } as unknown as PrismaService;
    const svc = new WorkerWalletService(prisma);
    expect(await svc.duesBlocked(USER_ID, 50_000)).toBe(true); // at the threshold
    expect(await svc.duesBlocked(USER_ID, 50_001)).toBe(false); // just under
  });

  it('duesBlocked() is false for a Ranger with no wallet row (zero dues)', async () => {
    const prisma = {
      workerWallet: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const svc = new WorkerWalletService(prisma);
    expect(await svc.duesBlocked(USER_ID, 1)).toBe(false);
  });

  it('settleDues() refuses when there are no dues', async () => {
    const prisma = {
      workerWallet: { findUnique: jest.fn().mockResolvedValue({ id: WALLET_ID, duesPaise: 0 }) },
    } as unknown as PrismaService;
    const svc = new WorkerWalletService(prisma);
    await expect(svc.settleDues(USER_ID, 1000)).rejects.toThrow();
  });

  it('settleDues() caps the settled amount at the outstanding dues', async () => {
    const tx = {
      workerWallet: { update: jest.fn() },
      workerWalletLedgerEntry: { create: jest.fn() },
    };
    const prisma = {
      workerWallet: {
        findUnique: jest.fn().mockResolvedValue({ id: WALLET_ID, duesPaise: 3000 }),
      },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaService;
    const svc = new WorkerWalletService(prisma);
    const res = await svc.settleDues(USER_ID, 10_000); // asks to pay more than owed
    expect(res).toEqual({ settledPaise: 3000 });
    expect(tx.workerWallet.update).toHaveBeenCalledWith({
      where: { id: WALLET_ID },
      data: { duesPaise: { decrement: 3000 } },
    });
  });

  it('withdraw() refuses when the balance is too low', async () => {
    const prisma = {
      workerWallet: {
        findUnique: jest.fn().mockResolvedValue({ id: WALLET_ID, balancePaise: 500 }),
      },
    } as unknown as PrismaService;
    const svc = new WorkerWalletService(prisma);
    await expect(svc.withdraw(USER_ID, 1000)).rejects.toThrow();
  });

  it('withdraw() moves the full requested amount when there is enough balance', async () => {
    const tx = {
      workerWallet: { update: jest.fn() },
      workerWalletLedgerEntry: { create: jest.fn() },
    };
    const prisma = {
      workerWallet: {
        findUnique: jest.fn().mockResolvedValue({ id: WALLET_ID, balancePaise: 5000 }),
      },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaService;
    const svc = new WorkerWalletService(prisma);
    const res = await svc.withdraw(USER_ID, 2000);
    expect(res).toEqual({ withdrawnPaise: 2000 });
    expect(tx.workerWallet.update).toHaveBeenCalledWith({
      where: { id: WALLET_ID },
      data: { balancePaise: { decrement: 2000 } },
    });
  });
});
