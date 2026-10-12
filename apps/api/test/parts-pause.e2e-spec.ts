import { type Harness, startHarness } from './harness';
import { CENTER, type Customer, Market, northOf, type Ranger } from './market-helpers';

let h: Harness;
let m: Market;

beforeAll(async () => {
  h = await startHarness();
  m = new Market(h.app);
});
afterAll(async () => {
  await h?.stop();
});

let areaCounter = 0;
const newArea = () => ({ lat: 20.0 + ++areaCounter * 0.4, lng: 77.5 });

/** Through the real endpoints, no quote flow involved: matched -> auto-agreed -> arrived ->
 * before-photo -> started (IN_PROGRESS), the state every pause test starts from. */
async function toInProgress(c: Customer, r: Ranger, jobId: string) {
  await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
  await m.ping(r, CENTER);
  await m.api.post(r, `/v1/jobs/${jobId}/arrive`).expect(200);
  const code = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
  await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code }).expect(200);
  await m.uploadJobPhoto(r, jobId, 'BEFORE').then((x) => expect(x.status).toBe(200));
  await m.api.post(r, `/v1/jobs/${jobId}/start`).expect(200);
}

describe('D-087 (Sub-phase I, core): pausing an in-progress job to fetch a part', () => {
  it('Ranger pauses then resumes — IN_PROGRESS -> PAUSED_PARTS -> IN_PROGRESS', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    await toInProgress(c, r, jobId);

    const paused = await m.api
      .post(r, `/v1/jobs/${jobId}/pause`, {
        reason: 'Need a new capacitor from the shop',
        expectedReturnAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(200);
    expect(paused.body.status).toBe('PAUSED_PARTS');
    expect(paused.body.pause).toMatchObject({ extensionCount: 1 });

    const resumed = await m.api.post(r, `/v1/jobs/${jobId}/pause/resume`).expect(200);
    expect(resumed.body.status).toBe('IN_PROGRESS');
    expect(resumed.body.pause).toBeNull();
  });

  it('a pause cannot be requested more times than max_parts_extensions', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    await toInProgress(c, r, jobId);

    const cfg = await m.fee.get();
    for (let i = 0; i < cfg.max_parts_extensions; i++) {
      await m.api
        .post(r, `/v1/jobs/${jobId}/pause`, {
          reason: `Trip ${i + 1}`,
          expectedReturnAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        })
        .expect(200);
      await m.api.post(r, `/v1/jobs/${jobId}/pause/resume`).expect(200);
    }
    const overCap = await m.api.post(r, `/v1/jobs/${jobId}/pause`, {
      reason: 'One more trip',
      expectedReturnAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(overCap.status).toBe(409);
    expect(overCap.body.error.details.code).toBe('EXTENSION_CAP_REACHED');
  });

  it('the customer can decline to keep waiting — PAUSED_PARTS -> CANCELLED, visit fee frozen', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    await toInProgress(c, r, jobId);
    await m.api
      .post(r, `/v1/jobs/${jobId}/pause`, {
        reason: 'Need a part',
        expectedReturnAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(200);

    const rejected = await m.api.post(c, `/v1/jobs/${jobId}/pause/reject`).expect(200);
    expect(rejected.body.status).toBe('CANCELLED');
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.visitFeePaise).toBeGreaterThan(0);
    expect(job.closeReason).toBe('EXTENSION_REJECTED');
  });

  it('the Ranger can close the job as parts-unavailable — visit fee still charged', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    await toInProgress(c, r, jobId);
    await m.api
      .post(r, `/v1/jobs/${jobId}/pause`, {
        reason: 'Need a part',
        expectedReturnAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(200);

    const closed = await m.api.post(r, `/v1/jobs/${jobId}/pause/unavailable`).expect(200);
    expect(closed.body.status).toBe('CANCELLED');
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.visitFeePaise).toBeGreaterThan(0);
    expect(job.closeReason).toBe('PARTS_UNAVAILABLE');
  });

  it('cannot pause a job that is not IN_PROGRESS', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    const tooSoon = await m.api.post(r, `/v1/jobs/${jobId}/pause`, {
      reason: 'Need a part',
      expectedReturnAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error.details.code).toBe('NOT_IN_PROGRESS');
  });
});
