import { type Harness, startHarness } from './harness';
import { Market } from './market-helpers';

let h: Harness;
let m: Market;

beforeAll(async () => {
  h = await startHarness();
  m = new Market(h.app);
});
afterAll(async () => {
  await h?.stop();
});

// runToCompletion() (inside Market.confirmJob()) pings the Ranger at CENTER, which is also
// Market.customer()'s default address, so every customer/Ranger pair here uses the defaults
// (no `at` override) to stay within the arrival geofence.

/** A customer + Ranger + a job run all the way to CONFIRMED_BY_CUSTOMER, ready to review. */
async function confirmedJob() {
  const c = await m.customer();
  const r = await m.ranger();
  const { jobId } = await m.match(c, r);
  await m.agree(c, r, jobId);
  await m.confirmJob(c, r, jobId);
  return { c, r, jobId };
}

describe('reviews (Phase 4, D: money never enters here — see D-037)', () => {
  it('before confirmation, neither party can review', async () => {
    const c = await m.customer();
    const r = await m.ranger();
    const { jobId } = await m.match(c, r);
    await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 5 }).expect(409);
    await m.api.post(r, `/v1/jobs/${jobId}/review`, { rating: 5 }).expect(409);
  });

  it('the job view says canReview once confirmed, for both parties, until they submit', async () => {
    const { c, r, jobId } = await confirmedJob();
    const cView = (await m.api.get(c, `/v1/jobs/${jobId}`).expect(200)).body;
    expect(cView.review).toEqual({ canReview: true, submitted: false });
    const rView = (await m.api.get(r, `/v1/jobs/${jobId}`).expect(200)).body;
    expect(rView.review).toEqual({ canReview: true, submitted: false });
  });

  it('the customer can rate the Ranger 1-5 with a comment, and the job view reflects it', async () => {
    const { c, jobId } = await confirmedJob();
    const res = await m.api
      .post(c, `/v1/jobs/${jobId}/review`, { rating: 5, comment: 'Fixed it fast, very polite.' })
      .expect(201);
    expect(res.body).toEqual({
      canReview: false,
      submitted: true,
      reviews: [
        expect.objectContaining({
          raterRole: 'CUSTOMER',
          rating: 5,
          comment: 'Fixed it fast, very polite.',
        }),
      ],
    });
    const view = (await m.api.get(c, `/v1/jobs/${jobId}`).expect(200)).body;
    expect(view.review).toEqual({ canReview: false, submitted: true });
  });

  it('a customer cannot review the same job twice', async () => {
    const { c, jobId } = await confirmedJob();
    await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 4 }).expect(201);
    const res = await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 1 }).expect(409);
    expect(res.body.error.details.code).toBe('ALREADY_REVIEWED');
  });

  it('the Ranger can independently rate the customer; the two reviews do not block each other', async () => {
    const { c, r, jobId } = await confirmedJob();
    await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 5 }).expect(201);
    const res = await m.api
      .post(r, `/v1/jobs/${jobId}/review`, { rating: 3, comment: 'Address was hard to find.' })
      .expect(201);
    expect(res.body.reviews).toHaveLength(2);
    expect(res.body.reviews.map((x: { raterRole: string }) => x.raterRole).sort()).toEqual([
      'CUSTOMER',
      'WORKER',
    ]);
  });

  it('a rating outside 1-5 is refused by validation', async () => {
    const { c, jobId } = await confirmedJob();
    await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 0 }).expect(400);
    await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 6 }).expect(400);
  });

  it("a stranger cannot review, or even see, someone else's job", async () => {
    const { jobId } = await confirmedJob();
    const stranger = await m.customer();
    await m.api.post(stranger, `/v1/jobs/${jobId}/review`, { rating: 5 }).expect(404);
    await m.api.get(stranger, `/v1/jobs/${jobId}/reviews`).expect(404);
  });

  it("the Ranger's rating average, count and job view update after a review", async () => {
    const { c, r, jobId } = await confirmedJob();
    await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 4 }).expect(201);
    const view = (await m.api.get(c, `/v1/jobs/${jobId}`).expect(200)).body;
    expect(view.worker.ratingAvg).toBe(4);
    expect(view.worker.ratingCount).toBe(1);
    const stats = await m.prisma.workerStats.findUniqueOrThrow({
      where: { workerUserId: r.userId },
    });
    expect(stats.ratingSum).toBe(4);
    expect(stats.ratingCount).toBe(1);
  });

  it('a Ranger with no ratings yet shows ratingAvg null, not 0 (never looks like a bad rating)', async () => {
    const c = await m.customer();
    const r = await m.ranger();
    const { jobId } = await m.match(c, r);
    const view = (await m.api.get(c, `/v1/jobs/${jobId}`).expect(200)).body;
    expect(view.worker.ratingAvg).toBeNull();
    expect(view.worker.ratingCount).toBe(0);
  });

  it("a Ranger's public review list shows only customer -> Ranger reviews, newest first, paginated", async () => {
    const r = await m.ranger();
    for (let i = 0; i < 3; i++) {
      const c = await m.customer();
      const { jobId } = await m.match(c, r);
      await m.agree(c, r, jobId);
      await m.confirmJob(c, r, jobId);
      await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 5 }).expect(201);
      await m.api.post(r, `/v1/jobs/${jobId}/review`, { rating: 5 }).expect(201); // never leaks into the Ranger's own list
    }
    const stranger = await m.customer();
    const page1 = await m.api.get(stranger, `/v1/rangers/${r.userId}/reviews?limit=2`).expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await m.api
      .get(stranger, `/v1/rangers/${r.userId}/reviews?limit=2&cursor=${page1.body.nextCursor}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
    const all = [...page1.body.items, ...page2.body.items];
    expect(all.every((x: { rating: number }) => x.rating === 5)).toBe(true);
    expect(all.every((x: { customerFirstName: string }) => x.customerFirstName === 'Asha')).toBe(
      true,
    );
  });

  it('badge tier climbs to SILVER once a Ranger has enough jobs and a strong enough average', async () => {
    const r = await m.ranger();
    for (let i = 0; i < 5; i++) {
      const c = await m.customer();
      const { jobId } = await m.match(c, r);
      await m.agree(c, r, jobId);
      await m.confirmJob(c, r, jobId);
      await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 5 }).expect(201);
    }
    const stats = await m.prisma.workerStats.findUniqueOrThrow({
      where: { workerUserId: r.userId },
    });
    expect(stats.jobsCompleted).toBe(5);
    expect(stats.badgeTier).toBe('SILVER');
  });

  it('badge tier stays BRONZE with plenty of jobs but a poor average', async () => {
    const r = await m.ranger();
    for (let i = 0; i < 5; i++) {
      const c = await m.customer();
      const { jobId } = await m.match(c, r);
      await m.agree(c, r, jobId);
      await m.confirmJob(c, r, jobId);
      await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 2 }).expect(201);
    }
    const stats = await m.prisma.workerStats.findUniqueOrThrow({
      where: { workerUserId: r.userId },
    });
    expect(stats.jobsCompleted).toBe(5);
    expect(stats.badgeTier).toBe('BRONZE');
  });
});

describe('blocking (Phase 4: user-facing side of the matching exclusion built in Phase 2)', () => {
  it('starts empty', async () => {
    const c = await m.customer();
    const res = await m.api.get(c, '/v1/me/blocks').expect(200);
    expect(res.body).toEqual([]);
  });

  it('blocks and unblocks someone, listing shows their first name and reason', async () => {
    const c = await m.customer();
    const other = await m.customer();
    await m.api
      .post(c, '/v1/me/blocks', { userId: other.userId, reason: 'Rude in chat' })
      .expect(201);
    const list = await m.api.get(c, '/v1/me/blocks').expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ userId: other.userId, firstName: 'Asha', reason: 'Rude in chat' }),
    ]);
    await m.api.del(c, `/v1/me/blocks/${other.userId}`).expect(200);
    const after = await m.api.get(c, '/v1/me/blocks').expect(200);
    expect(after.body).toEqual([]);
  });

  it('cannot block yourself', async () => {
    const c = await m.customer();
    await m.api.post(c, '/v1/me/blocks', { userId: c.userId }).expect(422);
  });

  it('blocking a nonexistent user is refused', async () => {
    const c = await m.customer();
    await m.api
      .post(c, '/v1/me/blocks', { userId: '11111111-1111-4111-8111-111111111111' })
      .expect(404);
  });

  it('blocking twice is idempotent (upserts, does not error, updates the reason)', async () => {
    const c = await m.customer();
    const other = await m.customer();
    await m.api
      .post(c, '/v1/me/blocks', { userId: other.userId, reason: 'first reason' })
      .expect(201);
    await m.api
      .post(c, '/v1/me/blocks', { userId: other.userId, reason: 'updated reason' })
      .expect(201);
    const list = await m.api.get(c, '/v1/me/blocks').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].reason).toBe('updated reason');
  });

  it('a blocked Ranger is excluded from broadcasts, in either direction', async () => {
    const c = await m.customer();
    const r = await m.ranger();
    await m.api.post(c, '/v1/me/blocks', { userId: r.userId }).expect(201);
    const { jobId } = await m.open(c);
    expect(await m.prisma.requestBroadcast.count({ where: { jobId, workerId: r.userId } })).toBe(0);
  });

  it("the exclusion works the other way too: a Ranger blocking a customer is never invited to that customer's requests", async () => {
    const c = await m.customer();
    const r = await m.ranger();
    await m.api.post(r, '/v1/me/blocks', { userId: c.userId }).expect(201);
    const { jobId } = await m.open(c);
    expect(await m.prisma.requestBroadcast.count({ where: { jobId, workerId: r.userId } })).toBe(0);
  });
});
