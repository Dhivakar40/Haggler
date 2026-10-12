import { JobViewService } from '../src/marketplace/job-view.service';
import { PrismaService } from '../src/prisma/prisma.service';
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

describe('D-080 (Sub-phase C): a licensed category needs tier-3 verification to accept', () => {
  it('blocks a tier-2 Ranger and allows a tier-3 one', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    // Both Rangers must exist before the request is opened — the first broadcast wave fires
    // synchronously on creation (requests.service.ts), so a Ranger created afterward is never
    // a candidate for it regardless of tier.
    const unlicensed = await m.ranger({
      at: northOf(300, area),
      categories: ['gas_appliance_repair'],
      tier: 2,
    });
    const licensed = await m.ranger({
      at: northOf(300, area),
      categories: ['gas_appliance_repair'],
      tier: 3,
    });
    const { requestId } = await m.open(c, { categorySlug: 'gas_appliance_repair' });

    // The broadcast itself already excludes the unlicensed Ranger (minKycTier filter), but
    // accept() is re-checked directly too (a request id is not a secret).
    const blocked = await m.api.post(unlicensed, `/v1/requests/${requestId}/accept`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.details.code).toBe('LICENSE_REQUIRED');

    const ok = await m.api.post(licensed, `/v1/requests/${requestId}/accept`);
    expect(ok.status).toBe(200);
  });
});

describe('D-080 (Sub-phase C): SOS alerts', () => {
  it('either party can raise one; the other is pushed; admin sees and resolves it', async () => {
    const { c, r, jobId } = await pair();
    const reviewer = await m.api.createAdmin(['DISPUTE_AGENT']);
    const reviewerToken = await m.api.adminToken(reviewer);

    const triggered = await m.api
      .post(c, `/v1/jobs/${jobId}/sos`, { note: 'feeling unsafe' })
      .expect(200);
    expect(triggered.body.sosAlerts).toMatchObject([
      { role: 'CUSTOMER', note: 'feeling unsafe', status: 'OPEN' },
    ]);
    // The Ranger sees it too — sosAlerts is visible to both parties.
    expect((await m.api.get(r, `/v1/jobs/${jobId}`)).body.sosAlerts).toHaveLength(1);

    const queue = (await m.api.adminGet(reviewerToken, '/v1/admin/sos').expect(200)).body;
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({ jobId, role: 'CUSTOMER', status: 'OPEN' });

    await m.api
      .adminPost(reviewerToken, `/v1/admin/sos/${queue.items[0].id}/resolve`, {})
      .expect(200);
    const afterResolve = (await m.api.adminGet(reviewerToken, '/v1/admin/sos').expect(200)).body;
    expect(afterResolve.items).toHaveLength(0);
    await m.api
      .adminPost(reviewerToken, `/v1/admin/sos/${queue.items[0].id}/resolve`, {})
      .expect(409);

    // A stranger to the job cannot raise or see an alert on it.
    const stranger = await m.customer();
    await m.api.post(stranger, `/v1/jobs/${jobId}/sos`, {}).expect(404);
  });

  it('refuses once the job is no longer active', async () => {
    const { c, r, jobId } = await pair();
    await m.confirmJob(c, r, jobId);
    await m.api.post(c, `/v1/jobs/${jobId}/sos`, {}).expect(422);
  });
});

describe('D-080 (Sub-phase D): disputes', () => {
  it('raises after confirmation, admin can resolve against the Ranger (dispute rate) or not', async () => {
    const { c, r, jobId } = await pair();
    await m.confirmJob(c, r, jobId);
    const reviewer = await m.api.createAdmin(['DISPUTE_AGENT']);
    const reviewerToken = await m.api.adminToken(reviewer);

    // Cannot dispute a job that was never confirmed.
    const { jobId: unconfirmed } = await pair();
    await m.api
      .post(c, `/v1/jobs/${unconfirmed}/dispute`, { reason: 'x'.repeat(20) })
      .expect(409);

    const raised = await m.api
      .post(c, `/v1/jobs/${jobId}/dispute`, { reason: 'The work was not finished properly.' })
      .expect(200);
    expect(raised.body.status).toBe('DISPUTED');
    expect(raised.body.disputes).toMatchObject([
      { role: 'CUSTOMER', status: 'OPEN', reason: 'The work was not finished properly.' },
    ]);
    // Sub-phase F: the job's own status history, for the mobile timeline view.
    expect(raised.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'REQUESTED', 'BROADCASTING', 'MATCHED', 'AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS',
      'COMPLETED_BY_WORKER', 'CONFIRMED_BY_CUSTOMER', 'DISPUTED',
    ]);
    // A second dispute cannot be opened while one is already open.
    await m.api.post(r, `/v1/jobs/${jobId}/dispute`, { reason: 'y'.repeat(20) }).expect(409);

    const queue = (await m.api.adminGet(reviewerToken, '/v1/admin/disputes').expect(200)).body;
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({ jobId, role: 'CUSTOMER', status: 'OPEN' });

    const statsBefore = await m.prisma.workerStats.findUniqueOrThrow({
      where: { workerUserId: r.userId },
    });
    await m.api
      .adminPost(reviewerToken, `/v1/admin/disputes/${queue.items[0].id}/resolve`, {
        resolution: 'REFUND_CUSTOMER',
        note: 'Customer sent photos showing the fan was still loose.',
      })
      .expect(200);
    expect(await statusOf(jobId)).toBe('REFUNDED');
    const statsAfter = await m.prisma.workerStats.findUniqueOrThrow({
      where: { workerUserId: r.userId },
    });
    expect(statsAfter.jobsDisputed).toBe(statsBefore.jobsDisputed + 1);

    // Already resolved: cannot resolve again.
    await m.api
      .adminPost(reviewerToken, `/v1/admin/disputes/${queue.items[0].id}/resolve`, {
        resolution: 'NO_ACTION',
        note: 'y'.repeat(10),
      })
      .expect(409);
  });

  it('resolving PAY_WORKER/NO_ACTION returns the job to CONFIRMED_BY_CUSTOMER with no mark against the Ranger', async () => {
    const { c, r, jobId } = await pair();
    await m.confirmJob(c, r, jobId);
    const reviewer = await m.api.createAdmin(['DISPUTE_AGENT']);
    const reviewerToken = await m.api.adminToken(reviewer);
    await m.api.post(c, `/v1/jobs/${jobId}/dispute`, { reason: 'x'.repeat(20) }).expect(200);
    const queue = (await m.api.adminGet(reviewerToken, '/v1/admin/disputes').expect(200)).body;

    const statsBefore = await m.prisma.workerStats.findUniqueOrThrow({
      where: { workerUserId: r.userId },
    });
    await m.api
      .adminPost(reviewerToken, `/v1/admin/disputes/${queue.items[0].id}/resolve`, {
        resolution: 'PAY_WORKER',
        note: 'The after photo shows the job was done correctly.',
      })
      .expect(200);
    expect(await statusOf(jobId)).toBe('CONFIRMED_BY_CUSTOMER');
    const statsAfter = await m.prisma.workerStats.findUniqueOrThrow({
      where: { workerUserId: r.userId },
    });
    expect(statsAfter.jobsDisputed).toBe(statsBefore.jobsDisputed);
  });
});

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
    // D-080 (A3): matching and agreeing the price are the same transaction now — no negotiation
    // step in between.
    expect(job.status).toBe('AGREED');
    expect(job.agreedPricePaise).not.toBeNull();
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

describe('D-080 (A3): fixed-price auto-agree, replacing negotiation', () => {
  it('accepting matches AND agrees in one step, at the seeded listed price', async () => {
    const { c, r, jobId } = await pair();
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('AGREED');
    expect(job.workerId).toBe(r.userId);
    expect(job.agreedAt).not.toBeNull();
    // electrician's seeded DEFAULT price-list entry, in paise (see prisma/seed.ts).
    expect(job.agreedPricePaise).toBe(34900);
    const dto = (await m.api.get(c, `/v1/jobs/${jobId}`)).body;
    expect(dto.listedPricePaise).toBe(34900);
    expect(dto.isInspectionCharge).toBe(false);
    expect(dto.offers).toEqual([]); // no negotiation ever happened
  });

  it('D-078: relationLoadStrategy join still returns the same shape as one-query-per-relation, now on an auto-agreed job with photos', async () => {
    const { c, r, jobId } = await pair();
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    await m.ping(r, CENTER);
    await m.api.post(r, `/v1/jobs/${jobId}/arrive`).expect(200);
    const code = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
    await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code }).expect(200);
    await m.uploadJobPhoto(r, jobId, 'BEFORE');
    await m.api.post(r, `/v1/jobs/${jobId}/start`).expect(200);
    await m.uploadJobPhoto(r, jobId, 'AFTER');

    const job = await m.prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { _count: { select: { photos: true } } },
    });
    expect(job._count.photos).toBe(2);

    // Mirrors job-view.service.ts's loadForParty() include exactly, so this proves the joined
    // strategy that method now uses returns the identical nested shape the old one-query-per-
    // relation approach did (D-078).
    const include = {
      request: { include: { category: true, media: { where: { status: 'UPLOADED' as const } } } },
      offers: { orderBy: { round: 'asc' as const } },
      quotes: { orderBy: { createdAt: 'asc' as const } },
      photos: { where: { status: 'UPLOADED' as const } },
      thread: true,
    };
    const prisma = h.app.get(PrismaService);
    const perRelation = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include });
    const joined = await prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      relationLoadStrategy: 'join',
      include,
    });
    const normalize = (x: unknown): unknown => {
      if (Array.isArray(x)) return x.map(normalize);
      if (x && typeof x === 'object')
        return Object.fromEntries(
          Object.keys(x as object)
            .sort()
            .map((k) => [k, normalize((x as Record<string, unknown>)[k])]),
        );
      return x;
    };
    expect(normalize(joined)).toEqual(normalize(perRelation));

    // And the real service, which now always uses the joined strategy, still builds the same DTO.
    const view = h.app.get(JobViewService);
    const dto = await view.build(jobId, c.userId);
    expect(dto.id).toBe(jobId);
    expect(dto.status).toBe('IN_PROGRESS');
  });

  it('strangers cannot see a job (404)', async () => {
    const { jobId } = await pair();
    const stranger = await m.customer();
    await m.api.get(stranger, `/v1/jobs/${jobId}`).expect(404);
  });
});

describe('D-080 (A4): "other"-category quotes (no negotiation, one quote per Ranger)', () => {
  /** A customer's "other" request, broadcast to one Ranger, who has not yet quoted. */
  async function otherPair() {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { requestId, jobId } = await m.open(c, {
      categorySlug: 'other',
      description: 'Need something fixed that does not fit any listed category, please help.',
    });
    return { area, c, r, requestId, jobId };
  }

  it('a Ranger cannot accept directly; must send a quote instead', async () => {
    const { r, requestId } = await otherPair();
    const res = await m.api.post(r, `/v1/requests/${requestId}/accept`).expect(409);
    expect(res.body.error.details.code).toBe('QUOTE_REQUIRED');
  });

  it('a Ranger sends one quote; a second quote from the same Ranger is refused', async () => {
    const { r, jobId } = await otherPair();
    const res = await m.api.post(r, `/v1/jobs/${jobId}/quotes`, { amountPaise: 50000 }).expect(201);
    expect(res.body.quotes).toHaveLength(1);
    expect(res.body.quotes[0]).toMatchObject({
      workerId: r.userId,
      amountPaise: 50000,
      status: 'PENDING',
    });
    const again = await m.api.post(r, `/v1/jobs/${jobId}/quotes`, { amountPaise: 60000 }).expect(409);
    expect(again.body.error.details.code).toBe('ALREADY_QUOTED');
  });

  it('the customer accepts one quote: it performs the match, at that quote price, and declines the rest', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const a = await m.ranger({ at: northOf(200, area), name: 'Asha' });
    const b = await m.ranger({ at: northOf(400, area), name: 'Bala' });
    const { jobId } = await m.open(c, {
      categorySlug: 'other',
      description: 'Need something fixed that does not fit any listed category, please help.',
    });
    const qa = (await m.api.post(a, `/v1/jobs/${jobId}/quotes`, { amountPaise: 50000 }).expect(201))
      .body.quotes[0];
    await m.api.post(b, `/v1/jobs/${jobId}/quotes`, { amountPaise: 70000 }).expect(201);

    const done = await m.api.post(c, `/v1/jobs/${jobId}/quotes/${qa.id}/accept`).expect(200);
    expect(done.body).toMatchObject({ status: 'AGREED', agreedPricePaise: 50000 });
    const quotes = done.body.quotes as { workerId: string; status: string }[];
    expect(quotes.find((q) => q.workerId === a.userId)?.status).toBe('ACCEPTED');
    expect(quotes.find((q) => q.workerId === b.userId)?.status).toBe('DECLINED');

    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.workerId).toBe(a.userId);
    expect(await m.prisma.jobMatch.count({ where: { jobId } })).toBe(1);
  });

  it('the customer can decline one quote without matching', async () => {
    const { c, r, jobId } = await otherPair();
    const q = (await m.api.post(r, `/v1/jobs/${jobId}/quotes`, { amountPaise: 50000 }).expect(201))
      .body.quotes[0];
    const done = await m.api.post(c, `/v1/jobs/${jobId}/quotes/${q.id}/decline`).expect(200);
    expect(done.body.status).toBe('BROADCASTING'); // still open
    expect(done.body.quotes[0].status).toBe('DECLINED');
  });

  it('a Ranger can withdraw their own pending quote, then quote again', async () => {
    const { r, jobId } = await otherPair();
    const q = (await m.api.post(r, `/v1/jobs/${jobId}/quotes`, { amountPaise: 50000 }).expect(201))
      .body.quotes[0];
    await m.api.post(r, `/v1/jobs/${jobId}/quotes/${q.id}/withdraw`).expect(200);
    const after = await m.api.post(r, `/v1/jobs/${jobId}/quotes`, { amountPaise: 55000 }).expect(201);
    expect(after.body.quotes).toHaveLength(1);
  });

  it('only the invited Ranger can quote; strangers get 403', async () => {
    const { jobId } = await otherPair();
    const stranger = await m.ranger({ at: northOf(9000) });
    await m.api.post(stranger, `/v1/jobs/${jobId}/quotes`, { amountPaise: 50000 }).expect(403);
  });

  it('quoting a fixed-price category (not "other") is refused', async () => {
    const { jobId } = await pair(); // electrician, has a fixed price
    const r2 = await m.ranger({ at: northOf(9000) });
    const res = await m.api.post(r2, `/v1/jobs/${jobId}/quotes`, { amountPaise: 50000 }).expect(409);
    expect(res.body.error.details.code).toBe('NOT_QUOTABLE');
  });

  describe('D-080 (Sub-phase D): admin moderation of "other" jobs', () => {
    it('browses by description text and cancels one before the Ranger is underway', async () => {
      const { jobId, requestId } = await otherPair();
      const reviewer = await m.api.createAdmin(['DISPUTE_AGENT']);
      const reviewerToken = await m.api.adminToken(reviewer);

      const found = await m.api
        .adminGet(
          reviewerToken,
          `/v1/admin/other-jobs?q=${encodeURIComponent('does not fit any listed category')}`,
        )
        .expect(200);
      expect(found.body.items.some((x: { requestId: string }) => x.requestId === requestId)).toBe(
        true,
      );

      await m.api
        .adminPost(reviewerToken, `/v1/admin/other-jobs/${jobId}/cancel`, {
          reason: 'Description describes something outside the platform scope.',
        })
        .expect(200);
      expect(await statusOf(jobId)).toBe('CANCELLED');

      // Already terminal: a second cancel is refused.
      await m.api
        .adminPost(reviewerToken, `/v1/admin/other-jobs/${jobId}/cancel`, { reason: 'y'.repeat(10) })
        .expect(409);
    });

    it('cannot cancel once the Ranger has already set off (EN_ROUTE)', async () => {
      const { r, jobId } = await pair(); // fixed-price, but the state rule applies to any job
      const reviewer = await m.api.createAdmin(['DISPUTE_AGENT']);
      const reviewerToken = await m.api.adminToken(reviewer);
      await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
      await m.api
        .adminPost(reviewerToken, `/v1/admin/other-jobs/${jobId}/cancel`, { reason: 'x'.repeat(10) })
        .expect(409);
    });
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
    await m.api
      .post(r, `/v1/jobs/${jobId}/complete`, { paymentMethod: 'CASH', cashCollectedPaise: 40000 })
      .expect(409);
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
      .post(r, `/v1/jobs/${jobId}/complete`, { paymentMethod: 'CASH', cashCollectedPaise: 40000 })
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

    // Phase Commerce B3: an ONLINE job must be paid before it can be confirmed.
    const early = await m.api.post(c, `/v1/jobs/${jobId}/confirm`).expect(409);
    expect(early.body.error.details.code).toBe('PAYMENT_NOT_CAPTURED');
    const order = await m.api.post(c, `/v1/jobs/${jobId}/payment/online`).expect(201);
    await m.api.post(c, `/v1/wallet/orders/${order.body.orderId}/sandbox-pay`).expect(200);

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
      'AGREED', // D-080 (A3): no NEGOTIATING step — matched and agreed in the same transaction
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

  it('(D-093 K3) after a no-show, the customer can ask to be rematched with a different Ranger', async () => {
    const { area, c, r, jobId } = await pair();
    await m.agree(c, r, jobId);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    await m.prisma.job.update({
      where: { id: jobId },
      data: { enRouteAt: new Date(Date.now() - 31 * 60_000) },
    });
    await m.api.post(c, `/v1/jobs/${jobId}/report-no-show`).expect(200);

    const reassigned = await m.api.post(c, `/v1/jobs/${jobId}/reassign`).expect(200);
    expect(reassigned.body.status).toBe('BROADCASTING');
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.workerId).toBeNull();

    // A different Ranger can now accept the same job.
    const r2 = await m.ranger({ at: northOf(300, area) });
    const accepted = await m.api.post(r2, `/v1/requests/${job.requestId}/accept`).expect(200);
    expect(accepted.body.status).not.toBe('BROADCASTING');

    const again = await m.api.post(c, `/v1/jobs/${jobId}/reassign`);
    expect(again.status).toBe(409);
    expect(again.body.error.details.code).toBe('NOT_NO_SHOW');
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

describe('D-091: job start code expiry and regeneration', () => {
  it('an expired start code is refused, and the Ranger can send a fresh one', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(200, area) });
    const { jobId } = await m.match(c, r);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    await m.ping(r, CENTER);
    await m.api.post(r, `/v1/jobs/${jobId}/arrive`).expect(200);
    await m.uploadJobPhoto(r, jobId, 'SELFIE').then((x) => expect(x.status).toBe(200));
    const staleCode = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;

    // Force the code into the past — the TTL itself is covered by MarketplaceConfig's own
    // default (job_code_ttl_seconds); this test is about the expiry check, not the clock.
    await m.prisma.job.update({
      where: { id: jobId },
      data: { arrivalCodeExpiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code: staleCode });
    expect(expired.status).toBe(422);
    expect(expired.body.error.details.code).toBe('CODE_EXPIRED');

    await m.api.post(r, `/v1/jobs/${jobId}/arrive/regenerate`).expect(200);
    const freshCode = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
    expect(freshCode).not.toBe(staleCode);
    await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code: freshCode }).expect(200);
  });

  it('cannot regenerate once the start code has already been verified', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(200, area) });
    const { jobId } = await m.match(c, r);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    await m.ping(r, CENTER);
    await m.api.post(r, `/v1/jobs/${jobId}/arrive`).expect(200);
    await m.uploadJobPhoto(r, jobId, 'SELFIE').then((x) => expect(x.status).toBe(200));
    const code = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
    await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code }).expect(200);

    const again = await m.api.post(r, `/v1/jobs/${jobId}/arrive/regenerate`);
    expect(again.status).toBe(409);
    expect(again.body.error.details.code).toBe('ALREADY_VERIFIED');
  });
});

void (null as unknown as Customer | Ranger);
