import { QuoteBuilderService } from './quote-builder.service';
import type { FeeService } from './fee.service';
import type { JobTransitions } from './job-transitions.service';
import type { JobViewService } from './job-view.service';
import type { PrismaService } from '../prisma/prisma.service';

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUSTOMER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CATEGORY_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CATALOG_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function makeDeps(opts: {
  jobStatus?: string;
  arrivalVerifiedAt?: Date | null;
  categoryFeeBps?: number | null;
  categoryCeilingBps?: number | null;
  catalogFloorPaise?: number;
  catalogCeilingBps?: number | null;
} = {}) {
  const job = {
    id: JOB_ID,
    workerId: WORKER_ID,
    customerId: CUSTOMER_ID,
    status: opts.jobStatus ?? 'ARRIVED',
    arrivalVerifiedAt: opts.arrivalVerifiedAt !== undefined ? opts.arrivalVerifiedAt : new Date(),
    request: {
      categoryId: CATEGORY_ID,
      category: { feeBps: opts.categoryFeeBps ?? null, ceilingMultipleBps: opts.categoryCeilingBps ?? null },
    },
  };
  const catalogItem = {
    id: CATALOG_ID,
    categoryId: CATEGORY_ID,
    name: 'Replace capacitor',
    pricePaise: opts.catalogFloorPaise ?? 40_000,
    ceilingMultipleBps: opts.catalogCeilingBps ?? null,
    isActive: true,
  };
  const move = jest.fn().mockResolvedValue(undefined);
  const upsert = jest.fn().mockResolvedValue({ id: 'quote-1' });
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const createMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    job: { findUnique: jest.fn().mockResolvedValue(job) },
    priceListAddOn: { findMany: jest.fn().mockResolvedValue([catalogItem]) },
    jobQuote: { upsert, deleteMany: jest.fn() },
    jobQuoteItem: { deleteMany, createMany },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        jobQuote: { upsert },
        jobQuoteItem: { deleteMany, createMany },
      }),
    ),
  } as unknown as PrismaService;
  const transitions = { move } as unknown as JobTransitions;
  const view = { build: jest.fn().mockResolvedValue({ id: JOB_ID }) } as unknown as JobViewService;
  const fee = {
    get: jest.fn().mockResolvedValue({ quote_extra_cap_bps: 1000 }),
    ceilingPaise: jest.fn().mockImplementation(async (floor: number, item: number | null, cat: number | null) => {
      const bps = item ?? cat ?? 15_000;
      return Math.round((floor * bps) / 10_000);
    }),
    computeFeePaise: jest.fn().mockResolvedValue(3_200),
  } as unknown as FeeService;
  return { prisma, transitions, view, fee, upsert, move };
}

describe('QuoteBuilderService.submit (D-087 Sub-phase G)', () => {
  it('rejects a labour item quoted below its floor', async () => {
    const { prisma, transitions, view, fee } = makeDeps({ catalogFloorPaise: 40_000 });
    const svc = new QuoteBuilderService(prisma, transitions, view, fee);
    await expect(
      svc.submit(WORKER_ID, JOB_ID, {
        items: [
          { kind: 'LABOUR', catalogItemId: CATALOG_ID, name: 'Replace capacitor', unitPricePaise: 30_000, quantity: 1 },
        ],
      }),
    ).rejects.toThrow();
  });

  it('a labour item above the ceiling needs a photo and a reason', async () => {
    const { prisma, transitions, view, fee } = makeDeps({ catalogFloorPaise: 40_000 });
    const svc = new QuoteBuilderService(prisma, transitions, view, fee);
    // 1.5x default ceiling = 60,000; 70,000 breaches it.
    await expect(
      svc.submit(WORKER_ID, JOB_ID, {
        items: [
          { kind: 'LABOUR', catalogItemId: CATALOG_ID, name: 'Replace capacitor', unitPricePaise: 70_000, quantity: 1 },
        ],
      }),
    ).rejects.toThrow();
  });

  it('accepts an above-ceiling quote once evidence is supplied, and flags it for review', async () => {
    const { prisma, transitions, view, fee, upsert } = makeDeps({ catalogFloorPaise: 40_000 });
    const svc = new QuoteBuilderService(prisma, transitions, view, fee);
    await svc.submit(WORKER_ID, JOB_ID, {
      items: [
        { kind: 'LABOUR', catalogItemId: CATALOG_ID, name: 'Replace capacitor', unitPricePaise: 70_000, quantity: 1 },
      ],
      aboveCeilingPhotoId: 'photo-1',
      aboveCeilingReason: 'The unit was corroded and needed a heavier-duty part.',
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ aboveCeiling: true, flaggedForReview: true }),
      }),
    );
  });

  it('a part needs a bill photo', async () => {
    const { prisma, transitions, view, fee } = makeDeps();
    const svc = new QuoteBuilderService(prisma, transitions, view, fee);
    await expect(
      svc.submit(WORKER_ID, JOB_ID, {
        items: [{ kind: 'PART', name: 'New capacitor', unitPricePaise: 15_000, quantity: 1 }],
      }),
    ).rejects.toThrow();
  });

  it('only one "extra" line is allowed', async () => {
    const { prisma, transitions, view, fee } = makeDeps();
    const svc = new QuoteBuilderService(prisma, transitions, view, fee);
    await expect(
      svc.submit(WORKER_ID, JOB_ID, {
        items: [
          { kind: 'EXTRA', name: 'Minor cleanup', unitPricePaise: 1_000, quantity: 1 },
          { kind: 'EXTRA', name: 'Also this', unitPricePaise: 1_000, quantity: 1 },
        ],
      }),
    ).rejects.toThrow();
  });

  it('the "extra" line is capped as a percent of labour', async () => {
    const { prisma, transitions, view, fee } = makeDeps({ catalogFloorPaise: 40_000 });
    const svc = new QuoteBuilderService(prisma, transitions, view, fee);
    // Labour 40,000; cap at 10% = 4,000; asking for 5,000 should be refused.
    await expect(
      svc.submit(WORKER_ID, JOB_ID, {
        items: [
          { kind: 'LABOUR', catalogItemId: CATALOG_ID, name: 'Replace capacitor', unitPricePaise: 40_000, quantity: 1 },
          { kind: 'EXTRA', name: 'Minor cleanup', unitPricePaise: 5_000, quantity: 1 },
        ],
      }),
    ).rejects.toThrow();
  });

  it('refuses a quote while the start code has not been verified yet', async () => {
    const { prisma, transitions, view, fee } = makeDeps({ arrivalVerifiedAt: null });
    const svc = new QuoteBuilderService(prisma, transitions, view, fee);
    await expect(
      svc.submit(WORKER_ID, JOB_ID, {
        items: [{ kind: 'PART', name: 'x', unitPricePaise: 100, quantity: 1, billPhotoId: 'p' }],
      }),
    ).rejects.toThrow();
  });

  it('computes the right totals and moves the job to QUOTING', async () => {
    const { prisma, transitions, view, fee, move } = makeDeps({ catalogFloorPaise: 40_000 });
    const svc = new QuoteBuilderService(prisma, transitions, view, fee);
    await svc.submit(WORKER_ID, JOB_ID, {
      items: [
        { kind: 'LABOUR', catalogItemId: CATALOG_ID, name: 'Replace capacitor', unitPricePaise: 40_000, quantity: 1 },
        { kind: 'PART', name: 'New capacitor', unitPricePaise: 15_000, quantity: 1, billPhotoId: 'bill-1' },
      ],
    });
    expect(fee.computeFeePaise).toHaveBeenCalledWith(40_000, null);
    expect(move).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: 'ARRIVED', to: 'QUOTING', actor: 'WORKER' }),
    );
    expect(view.build).toHaveBeenCalledWith(JOB_ID, WORKER_ID);
  });
});
