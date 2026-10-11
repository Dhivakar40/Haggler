import { DisputeService } from './dispute.service';
import type { JobViewService } from './job-view.service';
import type { JobTransitions } from './job-transitions.service';
import type { PrismaService } from '../prisma/prisma.service';

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUSTOMER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORKER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STRANGER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makeDeps(
  job: { customerId: string; workerId: string | null; status: string } | null,
  openDispute: unknown = null,
) {
  const move = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    job: { findUnique: jest.fn().mockResolvedValue(job) },
    dispute: {
      findFirst: jest.fn().mockResolvedValue(openDispute),
      create: jest.fn().mockResolvedValue({ id: 'dispute-1' }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  } as unknown as PrismaService;
  const transitions = { move } as unknown as JobTransitions;
  const view = { build: jest.fn().mockResolvedValue({ id: JOB_ID }) } as unknown as JobViewService;
  return { prisma, transitions, view, move };
}

describe('DisputeService (D-080 Sub-phase D)', () => {
  it('404s for someone who is neither party on the job', async () => {
    const { prisma, transitions, view } = makeDeps({
      customerId: CUSTOMER_ID,
      workerId: WORKER_ID,
      status: 'CONFIRMED_BY_CUSTOMER',
    });
    const svc = new DisputeService(prisma, transitions, view);
    await expect(svc.raise(STRANGER_ID, JOB_ID, { reason: 'x'.repeat(10) })).rejects.toThrow();
  });

  it('refuses a job that is not yet confirmed (e.g. still in progress)', async () => {
    const { prisma, transitions, view } = makeDeps({
      customerId: CUSTOMER_ID,
      workerId: WORKER_ID,
      status: 'IN_PROGRESS',
    });
    const svc = new DisputeService(prisma, transitions, view);
    await expect(svc.raise(CUSTOMER_ID, JOB_ID, { reason: 'x'.repeat(10) })).rejects.toThrow();
  });

  it('refuses a second dispute while one is already open', async () => {
    const { prisma, transitions, view } = makeDeps(
      { customerId: CUSTOMER_ID, workerId: WORKER_ID, status: 'CONFIRMED_BY_CUSTOMER' },
      { id: 'existing' },
    );
    const svc = new DisputeService(prisma, transitions, view);
    await expect(svc.raise(CUSTOMER_ID, JOB_ID, { reason: 'x'.repeat(10) })).rejects.toThrow();
  });

  it('moves the job to DISPUTED and records who raised it', async () => {
    const { prisma, transitions, view, move } = makeDeps({
      customerId: CUSTOMER_ID,
      workerId: WORKER_ID,
      status: 'CONFIRMED_BY_CUSTOMER',
    });
    const svc = new DisputeService(prisma, transitions, view);
    await svc.raise(WORKER_ID, JOB_ID, { reason: 'The customer never paid in cash.' });

    expect(move).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: JOB_ID,
        from: 'CONFIRMED_BY_CUSTOMER',
        to: 'DISPUTED',
        actor: 'WORKER',
        actorUserId: WORKER_ID,
      }),
    );
    expect(prisma.dispute.create).toHaveBeenCalledWith({
      data: {
        jobId: JOB_ID,
        raisedBy: WORKER_ID,
        role: 'WORKER',
        reason: 'The customer never paid in cash.',
      },
    });
    expect(view.build).toHaveBeenCalledWith(JOB_ID, WORKER_ID);
  });
});
