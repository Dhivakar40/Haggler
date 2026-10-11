import { SosService } from './sos.service';
import type { JobViewService } from './job-view.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUSTOMER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORKER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STRANGER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makeDeps(job: { customerId: string; workerId: string | null; status: string } | null) {
  const notify = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    job: { findUnique: jest.fn().mockResolvedValue(job) },
    sosAlert: { create: jest.fn().mockResolvedValue({ id: 'alert-1' }) },
  } as unknown as PrismaService;
  const notifications = { notify } as unknown as NotificationsService;
  const view = { build: jest.fn().mockResolvedValue({ id: JOB_ID }) } as unknown as JobViewService;
  return { prisma, notifications, view, notify };
}

describe('SosService (D-080 Sub-phase C)', () => {
  it('404s for someone who is neither party on the job', async () => {
    const { prisma, notifications, view } = makeDeps({
      customerId: CUSTOMER_ID,
      workerId: WORKER_ID,
      status: 'IN_PROGRESS',
    });
    const svc = new SosService(prisma, notifications, view);
    await expect(svc.trigger(STRANGER_ID, JOB_ID, {})).rejects.toThrow();
  });

  it('refuses when the job is not active (e.g. already confirmed)', async () => {
    const { prisma, notifications, view } = makeDeps({
      customerId: CUSTOMER_ID,
      workerId: WORKER_ID,
      status: 'CONFIRMED_BY_CUSTOMER',
    });
    const svc = new SosService(prisma, notifications, view);
    await expect(svc.trigger(CUSTOMER_ID, JOB_ID, {})).rejects.toThrow();
  });

  it('a customer trigger creates a CUSTOMER alert and pushes the Ranger', async () => {
    const { prisma, notifications, view, notify } = makeDeps({
      customerId: CUSTOMER_ID,
      workerId: WORKER_ID,
      status: 'IN_PROGRESS',
    });
    const svc = new SosService(prisma, notifications, view);
    await svc.trigger(CUSTOMER_ID, JOB_ID, { note: 'help' });

    expect(prisma.sosAlert.create).toHaveBeenCalledWith({
      data: {
        jobId: JOB_ID,
        triggeredBy: CUSTOMER_ID,
        role: 'CUSTOMER',
        latitude: undefined,
        longitude: undefined,
        note: 'help',
      },
    });
    expect(notify).toHaveBeenCalledWith(
      WORKER_ID,
      expect.objectContaining({ data: { jobId: JOB_ID, type: 'sos' } }),
    );
    expect(view.build).toHaveBeenCalledWith(JOB_ID, CUSTOMER_ID);
  });

  it('a Ranger trigger creates a WORKER alert and pushes the customer', async () => {
    const { prisma, notifications, view, notify } = makeDeps({
      customerId: CUSTOMER_ID,
      workerId: WORKER_ID,
      status: 'EN_ROUTE',
    });
    const svc = new SosService(prisma, notifications, view);
    await svc.trigger(WORKER_ID, JOB_ID, {});

    expect(prisma.sosAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'WORKER' }) }),
    );
    expect(notify).toHaveBeenCalledWith(CUSTOMER_ID, expect.anything());
  });
});
