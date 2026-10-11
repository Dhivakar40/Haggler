import { JobAddOnsService } from './job-addons.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JobViewService } from './job-view.service';
import type { RealtimeService } from '../realtime/realtime.service';

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUSTOMER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADD_ON_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CATEGORY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

describe('JobAddOnsService (D-080, A5)', () => {
  const makeDeps = (over: {
    job?: Record<string, unknown> | null;
    addOn?: Record<string, unknown> | null;
    updateCount?: number;
  }) => {
    const prisma = {
      job: {
        findUnique: jest.fn().mockResolvedValue(
          over.job === undefined
            ? {
                id: JOB_ID,
                workerId: WORKER_ID,
                customerId: CUSTOMER_ID,
                status: 'IN_PROGRESS',
                request: { categoryId: CATEGORY_ID },
              }
            : over.job,
        ),
      },
      priceListAddOn: {
        findFirst: jest.fn().mockResolvedValue(
          over.addOn === undefined
            ? { id: ADD_ON_ID, name: 'Extra socket', pricePaise: 15000 }
            : over.addOn,
        ),
      },
      jobAddOn: {
        create: jest.fn().mockResolvedValue({ id: 'new-id' }),
        updateMany: jest.fn().mockResolvedValue({ count: over.updateCount ?? 1 }),
      },
    } as unknown as PrismaService;
    const view = { build: jest.fn().mockResolvedValue({ id: JOB_ID }) } as unknown as JobViewService;
    const realtime = { emitToUser: jest.fn() } as unknown as RealtimeService;
    return { prisma, view, realtime };
  };

  it('a Ranger proposes an add-on from the job category while IN_PROGRESS', async () => {
    const { prisma, view, realtime } = makeDeps({});
    const svc = new JobAddOnsService(prisma, view, realtime);
    await svc.propose(WORKER_ID, JOB_ID, ADD_ON_ID);
    expect(prisma.jobAddOn.create).toHaveBeenCalledWith({
      data: { jobId: JOB_ID, addOnId: ADD_ON_ID, name: 'Extra socket', pricePaise: 15000 },
    });
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.anything(),
      expect.objectContaining({ jobId: JOB_ID }),
    );
  });

  it('refuses to propose outside IN_PROGRESS', async () => {
    const { prisma, view, realtime } = makeDeps({
      job: {
        id: JOB_ID,
        workerId: WORKER_ID,
        customerId: CUSTOMER_ID,
        status: 'ARRIVED',
        request: { categoryId: CATEGORY_ID },
      },
    });
    const svc = new JobAddOnsService(prisma, view, realtime);
    await expect(svc.propose(WORKER_ID, JOB_ID, ADD_ON_ID)).rejects.toThrow();
    expect(prisma.jobAddOn.create).not.toHaveBeenCalled();
  });

  it('refuses an add-on that is not from this job category (or inactive)', async () => {
    const { prisma, view, realtime } = makeDeps({ addOn: null });
    const svc = new JobAddOnsService(prisma, view, realtime);
    await expect(svc.propose(WORKER_ID, JOB_ID, ADD_ON_ID)).rejects.toThrow();
  });

  it('a stranger worker gets 404, not the job', async () => {
    const { prisma, view, realtime } = makeDeps({});
    const svc = new JobAddOnsService(prisma, view, realtime);
    await expect(svc.propose('stranger', JOB_ID, ADD_ON_ID)).rejects.toThrow();
  });

  it('the customer approves a proposed add-on', async () => {
    const { prisma, view, realtime } = makeDeps({});
    const svc = new JobAddOnsService(prisma, view, realtime);
    await svc.approve(CUSTOMER_ID, JOB_ID, 'job-add-on-1');
    expect(prisma.jobAddOn.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-add-on-1', jobId: JOB_ID, status: 'PROPOSED' },
      data: { status: 'APPROVED', decidedAt: expect.any(Date) },
    });
    expect(realtime.emitToUser).toHaveBeenCalledWith(WORKER_ID, expect.anything(), {
      jobId: JOB_ID,
    });
  });

  it('declining an already-decided add-on is refused (race-safe via updateMany count)', async () => {
    const { prisma, view, realtime } = makeDeps({ updateCount: 0 });
    const svc = new JobAddOnsService(prisma, view, realtime);
    await expect(svc.decline(CUSTOMER_ID, JOB_ID, 'job-add-on-1')).rejects.toThrow();
  });
});
