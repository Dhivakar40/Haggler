import { type Harness, startHarness } from './harness';
import { CENTER, type Customer, Market, northOf, type Ranger } from './market-helpers';

let h: Harness;
let m: Market;

beforeAll(async () => {
  h = await startHarness();
  m = new Market(h.app);
});
afterAll(async () => {
  await m.disableQuoteFlow();
  await h?.stop();
});
beforeEach(async () => {
  await m.enableQuoteFlow();
});

let areaCounter = 0;
const newArea = () => ({ lat: 8.0 + ++areaCounter * 0.4, lng: 77.5 });

/** A labour catalogue item for the electrician category — floor ₹400, default 1.5x ceiling. */
async function makeLabourItem(floorPaise = 40_000) {
  const category = await m.prisma.serviceCategory.findUniqueOrThrow({
    where: { slug: 'electrician' },
  });
  return m.prisma.priceListAddOn.create({
    data: { categoryId: category.id, name: 'Replace ceiling fan capacitor', pricePaise: floorPaise },
  });
}

/** Through the real endpoints: matched -> en route -> arrived -> selfie -> start-code verified. */
async function arriveWithSelfie(c: Customer, r: Ranger, jobId: string) {
  await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
  await m.ping(r, CENTER);
  await m.api.post(r, `/v1/jobs/${jobId}/arrive`).expect(200);
  // The start code cannot be verified before the selfie is uploaded.
  const code = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
  const tooSoon = await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code });
  expect(tooSoon.status).toBe(422);
  expect(tooSoon.body.error.details.code).toBe('SELFIE_REQUIRED');
  await m.uploadJobPhoto(r, jobId, 'SELFIE').then((x) => expect(x.status).toBe(200));
  await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code }).expect(200);
}

describe('D-087 (Sub-phase G): the quote-first flow, behind quote_flow_enabled', () => {
  it('accept no longer auto-agrees a price — the job stays MATCHED, travels on spec', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('MATCHED');
    expect(job.agreedPricePaise).toBeNull();
    expect(job.platformFeePaise).toBeNull();
  });

  it('a labour item cannot be quoted below its floor, and a selfie is required before the start code', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    const item = await makeLabourItem(40_000);
    await arriveWithSelfie(c, r, jobId);

    const belowFloor = await m.api.post(r, `/v1/jobs/${jobId}/quote`, {
      items: [{ kind: 'LABOUR', catalogItemId: item.id, name: item.name, unitPricePaise: 30_000, quantity: 1 }],
    });
    expect(belowFloor.status).toBe(422);
    expect(belowFloor.body.error.details.code).toBe('BELOW_FLOOR');
  });

  it('the full happy path: quote, accept, start, finish — fee is on labour only', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    const item = await makeLabourItem(40_000);
    await arriveWithSelfie(c, r, jobId);

    const quoted = await m.api
      .post(r, `/v1/jobs/${jobId}/quote`, {
        items: [
          { kind: 'LABOUR', catalogItemId: item.id, name: item.name, unitPricePaise: 40_000, quantity: 1 },
          { kind: 'PART', name: 'New capacitor', unitPricePaise: 15_000, quantity: 1, billPhotoId: 'x' },
        ],
      })
      .expect(200);
    expect(quoted.body.status).toBe('QUOTING');
    expect(quoted.body.quotes[0]).toMatchObject({
      servicePaise: 40_000,
      partsPaise: 15_000,
      status: 'PENDING',
    });

    const agreed = await m.api.post(c, `/v1/jobs/${jobId}/quote/accept`).expect(200);
    expect(agreed.body.status).toBe('AGREED');
    // 8% of 40,000 labour = 3,200 (the default fee_bps seeded for D-087); parts carry no fee.
    expect(agreed.body.platformFeePaise).toBe(3_200);
    expect(agreed.body.agreedPricePaise).toBe(55_000); // 40,000 labour + 15,000 parts

    // The before photo is required at AGREED too, not only the pre-D-087 ARRIVED path.
    const tooSoon = await m.api.post(r, `/v1/jobs/${jobId}/start`);
    expect(tooSoon.status).toBe(422);
    await m.uploadJobPhoto(r, jobId, 'BEFORE').then((x) => expect(x.status).toBe(200));
    await m.api.post(r, `/v1/jobs/${jobId}/start`).expect(200);
    await m.uploadJobPhoto(r, jobId, 'AFTER').then((x) => expect(x.status).toBe(200));
    await m.api
      .post(r, `/v1/jobs/${jobId}/complete`, { paymentMethod: 'CASH', cashCollectedPaise: 58_200 })
      .expect(200);
    const confirmed = await m.api
      .post(c, `/v1/jobs/${jobId}/confirm`, { cashConfirmedPaise: 58_200 })
      .expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED_BY_CUSTOMER');
  });

  it('rejecting the quote freezes a visit fee and closes the job as QUOTE_REJECTED', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    const item = await makeLabourItem(40_000);
    await arriveWithSelfie(c, r, jobId);
    await m.api
      .post(r, `/v1/jobs/${jobId}/quote`, {
        items: [{ kind: 'LABOUR', catalogItemId: item.id, name: item.name, unitPricePaise: 40_000, quantity: 1 }],
      })
      .expect(200);

    const rejected = await m.api.post(c, `/v1/jobs/${jobId}/quote/reject`).expect(200);
    expect(rejected.body.status).toBe('QUOTE_REJECTED');
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.visitFeePaise).toBeGreaterThan(0);
    expect(job.closeReason).toBe('QUOTE_REJECTED');
  });

  it('above-ceiling needs a photo and a reason, and gets flagged for admin review', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    const item = await makeLabourItem(40_000); // 1.5x ceiling = 60,000
    await arriveWithSelfie(c, r, jobId);

    const noEvidence = await m.api.post(r, `/v1/jobs/${jobId}/quote`, {
      items: [{ kind: 'LABOUR', catalogItemId: item.id, name: item.name, unitPricePaise: 70_000, quantity: 1 }],
    });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.body.error.details.code).toBe('ABOVE_CEILING_EVIDENCE_REQUIRED');

    const withEvidence = await m.api
      .post(r, `/v1/jobs/${jobId}/quote`, {
        items: [{ kind: 'LABOUR', catalogItemId: item.id, name: item.name, unitPricePaise: 70_000, quantity: 1 }],
        aboveCeilingPhotoId: 'photo-1',
        aboveCeilingReason: 'The old unit was corroded and needed a heavier part.',
      })
      .expect(200);
    expect(withEvidence.body.quotes[0]).toMatchObject({ aboveCeiling: true, flaggedForReview: true });
  });
});
