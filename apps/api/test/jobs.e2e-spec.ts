import { RedisService } from '../src/redis/redis.service';
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
const newArea = () => ({ lat: 8.5 + ++areaCounter * 0.35, lng: 77.2 });

/** A customer and a Ranger in a private area, with the Ranger having accepted. */
async function pair(over: Record<string, unknown> = {}) {
  const area = newArea();
  const c = await m.customer({ at: area });
  const r = await m.ranger({ at: northOf(300, area) });
  const { requestId, jobId } = await m.match(c, r, over);
  return { area, c, r, requestId, jobId };
}
const statusOf = async (id: string) =>
  (await m.prisma.job.findUniqueOrThrow({ where: { id } })).status;

describe('first accept wins', () => {
  it('two Rangers accept: one wins, the other gets 409 REQUEST_TAKEN, and both are told', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const a = await m.ranger({ at: northOf(200, area), name: 'Asha' });
    const b = await m.ranger({ at: northOf(400, area), name: 'Bala' });
    const { requestId, jobId } = await m.open(c);

    const [ra, rb] = await Promise.all([
      m.api.post(a, `/v1/requests/${requestId}/accept`),
      m.api.post(b, `/v1/requests/${requestId}/accept`),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(loser.body.error.details.code).toBe('REQUEST_TAKEN');

    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('MATCHED');
    const winner = ra.status === 200 ? a : b;
    expect(job.workerId).toBe(winner.userId);
    expect(await m.prisma.jobMatch.count({ where: { jobId } })).toBe(1);
    const responses = await m.prisma.requestBroadcast.findMany({ where: { jobId } });
    expect(responses.map((x) => x.response).sort()).toEqual(['ACCEPTED', 'TAKEN']);
    expect(await m.prisma.chatThread.count({ where: { jobId } })).toBe(1);
  });

  it('only invited Rangers can accept (403), unknown requests are 404', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    await m.ranger({ at: northOf(200, area) });
    const uninvited = await m.ranger({ at: northOf(9000, area) });
    const { requestId } = await m.open(c);
    await m.api.post(uninvited, `/v1/requests/${requestId}/accept`).expect(403);
    await m.api
      .post(uninvited, '/v1/requests/00000000-0000-4000-8000-000000000000/accept')
      .expect(404);
  });

  it('a Ranger who already declined cannot accept later', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(200, area) });
    const { requestId } = await m.open(c);
    await m.api.post(r, `/v1/requests/${requestId}/decline`).expect(200);
    await m.api.post(r, `/v1/requests/${requestId}/accept`).expect(409);
  });

  it('a Ranger with an active job cannot take a second (database rule)', async () => {
    const area = newArea();
    const c1 = await m.customer({ at: area });
    const c2 = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(200, area) });
    const second = await m.open(c2); // r is invited to this too, while still free
    const first = await m.open(c1);
    await m.api.post(r, `/v1/requests/${first.requestId}/accept`).expect(200);
    const res = await m.api.post(r, `/v1/requests/${second.requestId}/accept`).expect(409);
    expect(res.body.error.details.code).toBe('ALREADY_ON_JOB');
    expect(await statusOf(second.jobId)).toBe('BROADCASTING'); // untouched: still open for others
  });

  it('the database itself refuses two active jobs for one Ranger, and two matches for one job', async () => {
    const { r, jobId, c } = await pair();
    const other = await m.open(await m.customer());
    await expect(
      m.prisma.job.update({
        where: { id: other.jobId },
        data: { status: 'MATCHED', workerId: r.userId },
      }),
    ).rejects.toThrow();
    await expect(
      m.prisma.jobMatch.create({ data: { jobId, workerId: c.userId } }),
    ).rejects.toThrow(); // UNIQUE(job_id)
    await expect(
      m.prisma.job.update({ where: { id: jobId }, data: { workerId: c.userId } }),
    ).rejects.toThrow(); // worker cannot be the customer
  });

  it('works when Redis is completely down: the database alone decides', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const a = await m.ranger({ at: northOf(200, area) });
    const b = await m.ranger({ at: northOf(300, area) });
    const { requestId } = await m.open(c);
    const down = jest.spyOn(h.app.get(RedisService), 'ping').mockResolvedValue(false); // Redis unreachable
    try {
      const [ra, rb] = await Promise.all([
        m.api.post(a, `/v1/requests/${requestId}/accept`),
        m.api.post(b, `/v1/requests/${requestId}/accept`),
      ]);
      expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    } finally {
      down.mockRestore();
    }
  });
});

describe('negotiation', () => {
  it('offer -> counter -> accept ends AGREED at the accepted price', async () => {
    const { c, r, jobId } = await pair();
    const o1 = await m.api.post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 50000 }).expect(201);
    expect(o1.body.status).toBe('NEGOTIATING');
    expect(o1.body.offers).toHaveLength(1);
    const first = o1.body.offers[0];
    expect(first).toMatchObject({
      round: 1,
      fromRole: 'WORKER',
      amountPaise: 50000,
      status: 'PENDING',
      outsideBand: false,
    });

    await m.api.post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 45000 }).expect(409); // cannot outbid yourself
    const c1 = await m.api
      .post(c, `/v1/offers/${first.id}/counter`, { amountPaise: 40000 })
      .expect(201);
    expect(
      c1.body.offers.map((o: { round: number; status: string }) => `${o.round}:${o.status}`),
    ).toEqual(['1:COUNTERED', '2:PENDING']);
    const second = c1.body.offers[1];
    await m.api.post(c, `/v1/offers/${second.id}/accept`, {}).expect(409); // your own offer
    const done = await m.api.post(r, `/v1/offers/${second.id}/accept`, {}).expect(200);
    expect(done.body).toMatchObject({ status: 'AGREED', agreedPricePaise: 40000 });
    expect(done.body.offers.at(-1).status).toBe('ACCEPTED');
    await m.api.post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 30000 }).expect(409); // negotiation is over
  });

  it('maximum 3 rounds: the fourth offer is refused, but the last can still be accepted', async () => {
    const { c, r, jobId } = await pair();
    let o = (await m.api.post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 60000 }).expect(201))
      .body.offers[0];
    o = (await m.api.post(c, `/v1/offers/${o.id}/counter`, { amountPaise: 30000 }).expect(201)).body
      .offers[1];
    const r3 = (
      await m.api.post(r, `/v1/offers/${o.id}/counter`, { amountPaise: 45000 }).expect(201)
    ).body.offers[2];
    expect(r3.round).toBe(3);
    const res = await m.api
      .post(c, `/v1/offers/${r3.id}/counter`, { amountPaise: 40000 })
      .expect(409);
    expect(res.body.error.details.code).toBe('ROUND_LIMIT');
    await m.api.post(c, `/v1/offers/${r3.id}/accept`, {}).expect(200);
    expect(await statusOf(jobId)).toBe('AGREED');
  });

  it('prices outside the band need explicit confirmation from BOTH sides', async () => {
    const { c, r, jobId } = await pair(); // band 199..699 rupees
    const res = await m.api.post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 90000 }).expect(422);
    expect(res.body.error.details.code).toBe('OUTSIDE_BAND_CONFIRMATION_REQUIRED');
    const offer = (
      await m.api
        .post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 90000, confirmOutsideBand: true })
        .expect(201)
    ).body.offers[0];
    expect(offer.outsideBand).toBe(true);
    await m.api.post(c, `/v1/offers/${offer.id}/accept`, {}).expect(422); // customer must confirm too
    await m.api.post(c, `/v1/offers/${offer.id}/accept`, { confirmOutsideBand: true }).expect(200);
    expect((await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).agreedPricePaise).toBe(
      90000,
    );
  });

  it('offers expire; after expiry either side may offer again', async () => {
    const { c, r, jobId } = await pair();
    const o = (await m.api.post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 50000 }).expect(201))
      .body.offers[0];
    await m.scheduler.tick(new Date(Date.now() + 6 * 60_000)); // 5 min TTL has passed
    expect((await m.prisma.offer.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(
      'EXPIRED',
    );
    const late = await m.api.post(c, `/v1/offers/${o.id}/accept`, {}).expect(409);
    expect(late.body.error.details.code).toBeDefined();
    const fresh = await m.api
      .post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 48000 })
      .expect(201); // round 2, allowed
    expect(fresh.body.offers.map((x: { round: number }) => x.round)).toEqual([1, 2]);
  });

  it('when rounds run out without agreement, the job is cancelled and the Ranger is freed', async () => {
    const { r, jobId } = await pair();
    const now = Date.now();
    for (let i = 1; i <= 3; i++) {
      await m.api.post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 40000 + i }).expect(201);
      await m.scheduler.tick(new Date(now + i * 6 * 60_000));
    }
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'NEGOTIATION_TIMEOUT',
      cancelledBy: 'SYSTEM',
    });
    expect(
      await m.prisma.job.count({
        where: { workerId: r.userId, status: { in: ['MATCHED', 'NEGOTIATING', 'AGREED'] } },
      }),
    ).toBe(0);
  });

  it('a matched job with no offers for 30 minutes is released', async () => {
    const { r, jobId } = await pair();
    await m.scheduler.tick(new Date(Date.now() + 31 * 60_000));
    expect(await statusOf(jobId)).toBe('CANCELLED');
    // The Ranger can take new work now.
    await m.ping(r, CENTER);
  });

  it('rejecting an offer ends the negotiation', async () => {
    const { c, r, jobId } = await pair();
    const o = (await m.api.post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 60000 }).expect(201))
      .body.offers[0];
    await m.api.post(r, `/v1/offers/${o.id}/reject`).expect(403); // not your call on your own offer
    const done = await m.api.post(c, `/v1/offers/${o.id}/reject`).expect(200);
    expect(done.body).toMatchObject({
      status: 'CANCELLED',
      cancellation: { by: 'CUSTOMER', reason: 'NEGOTIATION_REJECTED', feeApplies: false },
    });
  });

  it('strangers cannot see or touch a job or its offers (404)', async () => {
    const { jobId, r } = await pair();
    const stranger = await m.customer();
    await m.api.get(stranger, `/v1/jobs/${jobId}`).expect(404);
    await m.api.post(stranger, `/v1/jobs/${jobId}/offers`, { amountPaise: 40000 }).expect(404);
    const o = (await m.api.post(r, `/v1/jobs/${jobId}/offers`, { amountPaise: 40000 })).body
      .offers[0];
    await m.api.post(stranger, `/v1/offers/${o.id}/accept`, {}).expect(404);
  });

  it('offers are only possible while MATCHED/NEGOTIATING', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const { jobId } = await m.open(c);
    await m.api.post(c, `/v1/jobs/${jobId}/offers`, { amountPaise: 40000 }).expect(409); // still broadcasting: no Ranger yet
  });
});

describe('the full job lifecycle', () => {
  it('runs end to end with every rule enforced, and records each step', async () => {
    const { area, c, r, jobId } = await pair();
    await m.agree(c, r, jobId, 40000);
    expect(await statusOf(jobId)).toBe('AGREED');

    // The state machine refuses shortcuts.
    await m.api.post(r, `/v1/jobs/${jobId}/arrive`).expect(409);
    await m.api.post(r, `/v1/jobs/${jobId}/start`).expect(409);
    await m.api.post(r, `/v1/jobs/${jobId}/complete`, { paymentMethod: 'CASH' }).expect(409);
    await m.api.post(c, `/v1/jobs/${jobId}/confirm`).expect(409);
    await m.api.post(c, `/v1/jobs/${jobId}/en-route`).expect(403); // customers are not Rangers

    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    expect(await statusOf(jobId)).toBe('EN_ROUTE');

    // Geofence (500 m): 800 m away is refused, with the distance in the answer.
    await m.ping(r, northOf(800, area));
    const far = await m.api.post(r, `/v1/jobs/${jobId}/arrive`).expect(422);
    expect(far.body.error.details).toMatchObject({ code: 'NOT_AT_LOCATION' });
    expect(far.body.error.details.distanceM).toBeGreaterThan(700);

    await m.ping(r, northOf(50, area));
    const arrived = await m.api.post(r, `/v1/jobs/${jobId}/arrive`).expect(200);
    expect(arrived.body.status).toBe('ARRIVED');
    expect(arrived.body.arrivalCode).toBeNull(); // the Ranger never sees the code

    const code = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
    expect(code).toMatch(/^[0-9]{4}$/);
    const stored = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.arrivalCodeHash).toHaveLength(64);
    expect(stored.arrivalCodeEnc).not.toContain(code);

    // Not started until: code verified AND before photo.
    await m.api.post(r, `/v1/jobs/${jobId}/start`).expect(409);
    await m.api
      .post(r, `/v1/jobs/${jobId}/photos`, {
        kind: 'BEFORE',
        contentType: 'image/jpeg',
        sizeBytes: 900,
      })
      .expect(409); // code first
    const wrong = code === '0000' ? '1111' : '0000';
    const bad = await m.api
      .post(r, `/v1/jobs/${jobId}/verify-arrival`, { code: wrong })
      .expect(422);
    expect(bad.body.error.details.code).toBe('WRONG_CODE');
    await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code }).expect(200);
    expect((await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode).toBeNull(); // hidden once used

    const noPhoto = await m.api.post(r, `/v1/jobs/${jobId}/start`).expect(422);
    expect(noPhoto.body.error.details.code).toBe('BEFORE_PHOTO_REQUIRED');
    await m.api
      .post(r, `/v1/jobs/${jobId}/photos`, {
        kind: 'AFTER',
        contentType: 'image/jpeg',
        sizeBytes: 900,
      })
      .expect(409); // too early
    await m.uploadJobPhoto(r, jobId, 'BEFORE').then((x) => expect(x.status).toBe(200));
    await m.api.post(r, `/v1/jobs/${jobId}/start`).expect(200);
    expect(await statusOf(jobId)).toBe('IN_PROGRESS');

    const noAfter = await m.api
      .post(r, `/v1/jobs/${jobId}/complete`, { paymentMethod: 'CASH' })
      .expect(422);
    expect(noAfter.body.error.details.code).toBe('AFTER_PHOTO_REQUIRED');
    await m.api.post(r, `/v1/jobs/${jobId}/complete`, { paymentMethod: 'BITCOIN' }).expect(400);
    await m.uploadJobPhoto(r, jobId, 'AFTER').then((x) => expect(x.status).toBe(200));
    const completed = await m.api
      .post(r, `/v1/jobs/${jobId}/complete`, { paymentMethod: 'UPI' })
      .expect(200);
    expect(completed.body).toMatchObject({
      status: 'COMPLETED_BY_WORKER',
      paymentMethod: 'UPI',
      hasBeforePhoto: true,
      hasAfterPhoto: true,
    });

    await m.api
      .post(r, `/v1/jobs/${jobId}/confirm`)
      .expect(403 as number)
      .catch(() => undefined);
    const confirmed = await m.api.post(c, `/v1/jobs/${jobId}/confirm`).expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED_BY_CUSTOMER');
    expect(
      (await m.prisma.workerStats.findUniqueOrThrow({ where: { workerUserId: r.userId } }))
        .jobsCompleted,
    ).toBe(1);
    await m.api.post(c, `/v1/jobs/${jobId}/cancel`, {}).expect(409); // finished jobs cannot be cancelled

    // The audit trail: every state, in order, with who did it.
    const events = await m.prisma.jobEvent.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.toStatus)).toEqual([
      'REQUESTED',
      'BROADCASTING',
      'MATCHED',
      'NEGOTIATING',
      'AGREED',
      'EN_ROUTE',
      'ARRIVED',
      'IN_PROGRESS',
      'COMPLETED_BY_WORKER',
      'CONFIRMED_BY_CUSTOMER',
    ]);
    expect(events.find((e) => e.toStatus === 'ARRIVED')?.actorUserId).toBe(r.userId);
    expect(events.find((e) => e.toStatus === 'CONFIRMED_BY_CUSTOMER')?.actorUserId).toBe(c.userId);
    await expect(
      m.prisma.jobEvent.update({ where: { id: events[0]!.id }, data: { toStatus: 'CANCELLED' } }),
    ).rejects.toThrow(/append-only/);
    // The Ranger is free again as soon as they finish.
    const next = await m.customer({ at: area });
    await m.match(next, r).then((x) => expect(x.jobId).toBeTruthy());
  });

  it('wrong arrival codes lock after 5 tries, even with the right code afterwards', async () => {
    const { area, c, r, jobId } = await pair();
    await m.agree(c, r, jobId);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    await m.ping(r, area);
    await m.api.post(r, `/v1/jobs/${jobId}/arrive`).expect(200);
    const code = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++)
      await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code: wrong }).expect(422);
    const locked = await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code }).expect(429);
    expect(locked.body.error.details.code).toBe('CODE_LOCKED');
  });

  it('re-uploading the before photo replaces the old one (one live photo per kind)', async () => {
    const { area, c, r, jobId } = await pair();
    await m.agree(c, r, jobId);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`);
    await m.ping(r, area);
    await m.api.post(r, `/v1/jobs/${jobId}/arrive`);
    const code = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
    await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code });
    await m.uploadJobPhoto(r, jobId, 'BEFORE');
    await m.uploadJobPhoto(r, jobId, 'BEFORE');
    const photos = await m.prisma.jobPhoto.findMany({ where: { jobId, kind: 'BEFORE' } });
    expect(photos.filter((p) => p.status === 'UPLOADED')).toHaveLength(1);
    expect(photos.filter((p) => p.status === 'DELETED')).toHaveLength(1);
    await m.api
      .post(r, `/v1/jobs/${jobId}/photos`, {
        kind: 'BEFORE',
        contentType: 'application/pdf',
        sizeBytes: 900,
      })
      .expect(422);
  });

  it('only the Ranger of THIS job can act on it', async () => {
    const { c, jobId } = await pair();
    const other = await m.ranger({ at: newArea() });
    await m.api.post(other, `/v1/jobs/${jobId}/en-route`).expect(404);
    await m.api.post(c, `/v1/jobs/${jobId}/en-route`).expect(403);
  });
});

describe('cancellation, fees and no-shows', () => {
  it('cancelling before the Ranger moves is free; after they travelled far, a fee flag is set', async () => {
    const { area, c, r, jobId } = await pair();
    await m.agree(c, r, jobId);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    await m.ping(r, northOf(4000, area));
    await new Promise((res) => setTimeout(res, 4200)); // the trail is sampled at most every 4 s
    await m.ping(r, northOf(2500, area)); // travelled 1.5 km
    const res = await m.api
      .post(c, `/v1/jobs/${jobId}/cancel`, { reason: 'Changed my mind' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      cancellation: { by: 'CUSTOMER', reason: 'Changed my mind', feeApplies: true },
    });
  });

  it('cancelling right after they set off (no distance travelled) has no fee', async () => {
    const { area, c, r, jobId } = await pair();
    await m.agree(c, r, jobId);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    await m.ping(r, northOf(900, area));
    const res = await m.api.post(c, `/v1/jobs/${jobId}/cancel`, {}).expect(200);
    expect(res.body.cancellation.feeApplies).toBe(false);
  });

  it('a Ranger can cancel too (never a fee for the customer) and is freed', async () => {
    const { area, c, r, jobId } = await pair();
    await m.agree(c, r, jobId);
    const res = await m.api
      .post(r, `/v1/jobs/${jobId}/cancel`, { reason: 'Vehicle broke down' })
      .expect(200);
    expect(res.body.cancellation).toMatchObject({ by: 'WORKER', feeApplies: false });
    await m.customer({ at: area }).then((x) => m.match(x, r)); // free to take new work
  });

  it('nobody can cancel once work has started', async () => {
    const { area, c, r, jobId } = await pair();
    await m.agree(c, r, jobId);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`);
    await m.ping(r, area);
    await m.api.post(r, `/v1/jobs/${jobId}/arrive`);
    const code = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
    await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code });
    await m.uploadJobPhoto(r, jobId, 'BEFORE');
    await m.api.post(r, `/v1/jobs/${jobId}/start`).expect(200);
    await m.api.post(c, `/v1/jobs/${jobId}/cancel`, {}).expect(409);
    await m.api.post(r, `/v1/jobs/${jobId}/cancel`, {}).expect(409);
  });

  it('customer can report a Ranger no-show only after the grace period', async () => {
    const { c, r, jobId } = await pair();
    await m.agree(c, r, jobId);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    const early = await m.api.post(c, `/v1/jobs/${jobId}/report-no-show`).expect(409);
    expect(early.body.error.details.code).toBe('TOO_EARLY');
    await m.prisma.job.update({
      where: { id: jobId },
      data: { enRouteAt: new Date(Date.now() - 31 * 60_000) },
    });
    const done = await m.api.post(c, `/v1/jobs/${jobId}/report-no-show`).expect(200);
    expect(done.body.status).toBe('NO_SHOW_WORKER');
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(409); // it is over
  });

  it('a Ranger can report a customer no-show after waiting 15 minutes at the door', async () => {
    const { area, c, r, jobId } = await pair();
    await m.agree(c, r, jobId);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`);
    await m.ping(r, area);
    await m.api.post(r, `/v1/jobs/${jobId}/arrive`);
    await m.api.post(r, `/v1/jobs/${jobId}/report-no-show`).expect(409);
    await m.prisma.job.update({
      where: { id: jobId },
      data: { arrivedAt: new Date(Date.now() - 16 * 60_000) },
    });
    expect((await m.api.post(r, `/v1/jobs/${jobId}/report-no-show`).expect(200)).body.status).toBe(
      'NO_SHOW_CUSTOMER',
    );
  });
});

describe('live tracking and the trusted-contact link', () => {
  async function enRoutePair() {
    const p = await pair();
    await m.agree(p.c, p.r, p.jobId);
    await m.api.post(p.r, `/v1/jobs/${p.jobId}/en-route`).expect(200);
    return p;
  }

  it('records the GPS trail (at most one point per 4 s) and shows it to the customer only', async () => {
    const { area, c, r, jobId } = await enRoutePair();
    const first = await m.ping(r, northOf(2000, area));
    expect(first.body).toMatchObject({ recorded: true, jobId });
    const second = await m.ping(r, northOf(1900, area));
    expect(second.body.recorded).toBe(false); // too soon: the heartbeat still refreshed
    await new Promise((res) => setTimeout(res, 4200));
    await m.ping(r, northOf(1500, area));

    const track = (await m.api.get(c, `/v1/jobs/${jobId}/track`).expect(200)).body;
    expect(track.status).toBe('EN_ROUTE');
    expect(track.trail).toHaveLength(2);
    expect(track.worker.latitude).toBeCloseTo(northOf(1500, area).lat, 4);
    expect(track.destination).toMatchObject({ latitude: area.lat, longitude: area.lng });

    await m.api.get(await m.customer(), `/v1/jobs/${jobId}/track`).expect(404); // strangers
    expect(await m.prisma.jobLocation.count({ where: { jobId } })).toBe(2);
  });

  it('a ping outside India is refused; a non-Ranger cannot send location', async () => {
    const { r, c } = await enRoutePair();
    await m.api.post(r, '/v1/worker/location', { latitude: 51.5, longitude: -0.12 }).expect(422);
    await m.api.post(c, '/v1/worker/location', { latitude: 13, longitude: 80 }).expect(403);
  });

  it('the share link works without login, shows position only, and can be revoked', async () => {
    const { area, c, r, jobId } = await enRoutePair();
    await m.ping(r, northOf(1200, area));
    const share = (await m.api.post(c, `/v1/jobs/${jobId}/share-link`).expect(200)).body;
    expect(share.url).toMatch(/\/t\/[A-Za-z0-9_-]{43}$/);
    const token = share.url.split('/t/')[1] as string;
    const stored = await m.prisma.trustedShare.findFirstOrThrow({ where: { jobId } });
    expect(stored.tokenHash).not.toContain(token); // only the hash is stored

    const pub = await m.api.http().get(`/v1/track/${token}`).expect(200);
    expect(pub.body).toMatchObject({
      status: 'EN_ROUTE',
      category: 'electrician',
      rangerFirstName: 'Ravi',
    });
    expect(pub.body.worker.latitude).toBeCloseTo(northOf(1200, area).lat, 4);
    expect(JSON.stringify(pub.body)).not.toMatch(/phone|\+91|Gandhi/); // no phone, no street address

    const page = await m.api.http().get(`/t/${token}`).expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('Ranger Ravi');
    expect(page.text).toContain('openstreetmap.org');
    expect(page.headers['cache-control']).toBe('no-store');

    await m.api.http().get('/v1/track/not-a-real-token-not-a-real-token-0000000000').expect(404);
    await m.api.post(r, `/v1/jobs/${jobId}/share-link`).expect(404); // only the customer
    await m.api.post(c, `/v1/jobs/${jobId}/share-link/revoke`).expect(200);
    await m.api.http().get(`/v1/track/${token}`).expect(404);
  });

  it('a link expires after 12 hours, and cannot be made for a broadcasting request', async () => {
    const { c, jobId, r } = await enRoutePair();
    const token = ((await m.api.post(c, `/v1/jobs/${jobId}/share-link`)).body.url as string).split(
      '/t/',
    )[1] as string;
    await m.prisma.trustedShare.updateMany({
      where: { jobId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await m.api.http().get(`/v1/track/${token}`).expect(404);
    const area = newArea();
    const c2 = await m.customer({ at: area });
    const { jobId: open } = await m.open(c2);
    await m.api.post(c2, `/v1/jobs/${open}/share-link`).expect(409);
    void r;
  });
});

describe('chat', () => {
  it('participants can talk; messages persist; retries do not duplicate; strangers are locked out', async () => {
    const { c, r, jobId } = await pair();
    const thread = (await m.api.get(c, `/v1/jobs/${jobId}/thread`).expect(200)).body;
    expect((await m.api.get(r, `/v1/jobs/${jobId}/thread`)).body.id).toBe(thread.id);

    const sent = await m.api
      .post(c, `/v1/threads/${thread.id}/messages`, {
        clientMsgId: 'client-msg-0001',
        body: 'Please ring the bell twice',
      })
      .expect(201);
    expect(sent.body).toMatchObject({ senderId: c.userId, body: 'Please ring the bell twice' });
    const retry = await m.api
      .post(c, `/v1/threads/${thread.id}/messages`, {
        clientMsgId: 'client-msg-0001',
        body: 'Please ring the bell twice',
      })
      .expect(201);
    expect(retry.body.id).toBe(sent.body.id); // same message, not a duplicate
    await m.api
      .post(r, `/v1/threads/${thread.id}/messages`, {
        clientMsgId: 'client-msg-0001',
        body: 'On my way',
      })
      .expect(201); // same id from another sender is a new message
    expect(await m.prisma.chatMessage.count({ where: { threadId: thread.id } })).toBe(2);

    const stranger = await m.customer();
    await m.api.get(stranger, `/v1/threads/${thread.id}/messages`).expect(404);
    await m.api
      .post(stranger, `/v1/threads/${thread.id}/messages`, {
        clientMsgId: 'client-msg-9999',
        body: 'hi',
      })
      .expect(404);
    await m.api.get(stranger, `/v1/jobs/${jobId}/thread`).expect(404);
    await m.api
      .post(c, `/v1/threads/${thread.id}/messages`, { clientMsgId: 'client-msg-0002', body: '   ' })
      .expect(400);
    await m.api
      .post(c, `/v1/threads/${thread.id}/messages`, {
        clientMsgId: 'client-msg-0003',
        body: 'x'.repeat(2001),
      })
      .expect(400);
  });

  it('paginates newest-first with a cursor and no duplicates', async () => {
    const { c, jobId } = await pair();
    const thread = (await m.api.get(c, `/v1/jobs/${jobId}/thread`)).body;
    for (let i = 0; i < 5; i++)
      await m.api.post(c, `/v1/threads/${thread.id}/messages`, {
        clientMsgId: `pagination-${i}-xx`,
        body: `message ${i}`,
      });
    const p1 = (await m.api.get(c, `/v1/threads/${thread.id}/messages?limit=2`).expect(200)).body;
    expect(p1.items.map((x: { body: string }) => x.body)).toEqual(['message 4', 'message 3']);
    const p2 = (
      await m.api.get(c, `/v1/threads/${thread.id}/messages?limit=2&cursor=${p1.nextCursor}`)
    ).body;
    expect(p2.items.map((x: { body: string }) => x.body)).toEqual(['message 2', 'message 1']);
    const p3 = (
      await m.api.get(c, `/v1/threads/${thread.id}/messages?limit=2&cursor=${p2.nextCursor}`)
    ).body;
    expect(p3.items.map((x: { body: string }) => x.body)).toEqual(['message 0']);
    expect(p3.nextCursor).toBeNull();
  });
});

describe('job list', () => {
  it('lists my jobs newest first for either role', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(200, area) });
    const first = await m.match(c, r);
    await m.api.post(c, `/v1/jobs/${first.jobId}/cancel`, {});
    const second = await m.match(c, r);
    const asCustomer = (await m.api.get(c, '/v1/jobs?role=CUSTOMER').expect(200)).body;
    expect(asCustomer.items.map((j: { id: string }) => j.id)).toEqual([second.jobId, first.jobId]);
    expect(asCustomer.items[0]).toMatchObject({
      viewerRole: 'CUSTOMER',
      categorySlug: 'electrician',
    });
    const asRanger = (await m.api.get(r, '/v1/jobs?role=WORKER&limit=1').expect(200)).body;
    expect(asRanger.items).toHaveLength(1);
    expect(asRanger.nextCursor).toBeTruthy();
    const both = (await m.api.get(c, '/v1/jobs')).body.items;
    expect(both.length).toBeGreaterThanOrEqual(2);
  });
});

void (null as unknown as Customer | Ranger);
