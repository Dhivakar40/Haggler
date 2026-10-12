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

  it('(K3) the generic cancel endpoint refuses a PAUSED_PARTS job — it would skip the visit fee', async () => {
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

    const bypass = await m.api.post(c, `/v1/jobs/${jobId}/cancel`, {});
    expect(bypass.status).toBe(409);
    expect(bypass.body.error.details.code).toBe('USE_PAUSE_REJECT');
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('PAUSED_PARTS');
  });

  // NOTE: max_concurrent_paused_jobs_per_worker's check in PartsPauseService.requestPause() has
  // no test exercising the over-cap branch here. jobs_one_active_per_worker (a unique index from
  // D-087's foundation, covering PAUSED_PARTS too) already stops a Ranger from being matched to a
  // second job while any job — including a paused one — is still active, so the concurrency cap
  // can never actually be reached under the current matching rules. The check is left in as
  // defensive/future-proofing (in case that one-job-at-a-time rule is ever relaxed) rather than
  // removed, but it is honestly dead code today — see docs/DECISIONS.md D-092.

  it('(I2) a settlement proposal is capped at the agreed total, and survives into the closed job', async () => {
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

    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const tooMuch = await m.api.post(r, `/v1/jobs/${jobId}/pause/settlement`, {
      amountPaise: (job.agreedPricePaise ?? 0) + 1,
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.details.code).toBe('ABOVE_AGREED_TOTAL');

    const proposed = await m.api
      .post(r, `/v1/jobs/${jobId}/pause/settlement`, { amountPaise: 1_000 })
      .expect(200);
    expect(proposed.body.pauseSettlementPaise).toBe(1_000);

    const rejected = await m.api.post(c, `/v1/jobs/${jobId}/pause/reject`).expect(200);
    expect(rejected.body.status).toBe('CANCELLED');
    expect(rejected.body.pauseSettlementPaise).toBe(1_000);
  });

  it('(I3) an overdue pause gets flagged once, and the customer can acknowledge it', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    await toInProgress(c, r, jobId);
    await m.api
      .post(r, `/v1/jobs/${jobId}/pause`, {
        reason: 'Need a part',
        expectedReturnAt: new Date(Date.now() - 1000).toISOString(), // already overdue
      })
      .expect(200);

    await m.scheduler.tick();
    let job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.pausedOverdueNotifiedAt).not.toBeNull();

    // A second tick does not re-flag an already-flagged pause.
    const firstFlagAt = job.pausedOverdueNotifiedAt;
    await m.scheduler.tick();
    job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.pausedOverdueNotifiedAt).toEqual(firstFlagAt);

    await m.api.post(c, `/v1/jobs/${jobId}/pause/wait`).expect(200);
    job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.pausedOverdueNotifiedAt).toBeNull();
  });

  it('(I5) the Ranger can record an item handover, and the customer can sign off on it', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    await toInProgress(c, r, jobId);
    await m.api
      .post(r, `/v1/jobs/${jobId}/pause`, {
        reason: 'Taking the motor to the workshop',
        expectedReturnAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(200);

    const recorded = await m.api
      .post(r, `/v1/jobs/${jobId}/handovers`, {
        photoId: '00000000-0000-0000-0000-000000000000',
        description: 'Ceiling fan motor',
        workshop: 'Sri Lakshmi Electricals, Anna Nagar',
        expectedReturnAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      })
      .expect(200);
    const handover = recorded.body.itemHandovers[0];
    expect(handover).toMatchObject({ workshop: 'Sri Lakshmi Electricals, Anna Nagar' });
    expect(handover.customerSignedOffAt).toBeNull();

    const signedOff = await m.api
      .post(c, `/v1/jobs/${jobId}/handovers/${handover.id}/sign-off`)
      .expect(200);
    expect(signedOff.body.itemHandovers[0].customerSignedOffAt).not.toBeNull();
  });
});
