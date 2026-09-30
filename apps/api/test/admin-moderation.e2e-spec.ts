import type { INestApplication } from '@nestjs/common';
import { Api, type Session } from './helpers';
import { type Harness, startHarness } from './harness';
import { Market } from './market-helpers';

let h: Harness;
let app: INestApplication;
let api: Api;
let m: Market;
let agentToken: string;

beforeAll(async () => {
  h = await startHarness();
  app = h.app;
  api = new Api(app);
  m = new Market(app);
  const agent = await api.createAdmin(['DISPUTE_AGENT']);
  agentToken = await api.adminToken(agent);
});
afterAll(async () => {
  await h?.stop();
});

// runToCompletion() pings the Ranger at CENTER, which is also Market.customer()'s default
// address, so every customer/Ranger pair here uses the defaults (no `at` override).
async function confirmedJob() {
  const c = await m.customer();
  const r = await m.ranger();
  const { jobId } = await m.match(c, r);
  await m.agree(c, r, jobId);
  await m.confirmJob(c, r, jobId);
  return { c, r, jobId };
}

/** Creates the employer profile only. Verification (KYC_REVIEWER-gated, D-062) is done by each
 * test explicitly with a SUPER_ADMIN token, since this file's own admin (agentToken) is
 * DISPUTE_AGENT-only and cannot verify employers. */
async function employer(businessName = 'Acme Co'): Promise<Session> {
  const s = await api.signIn();
  const role = await api.post(s, '/v1/me/roles', { role: 'EMPLOYER' });
  if (role.status !== 201) throw new Error(`add EMPLOYER role failed: ${role.status}`);
  const profile = await api.patch(s, '/v1/employer/profile', { businessName });
  if (profile.status !== 200) throw new Error(`employer profile failed: ${profile.status}`);
  return s;
}

async function verifyEmployer(userId: string): Promise<void> {
  const superAdmin = await api.createAdmin(['SUPER_ADMIN']);
  const token = await api.adminToken(superAdmin);
  const ep = await api.prisma().employerProfile.findUniqueOrThrow({ where: { userId } });
  const res = await api.adminPost(token, `/v1/admin/employers/${ep.id}/verify`, {});
  if (res.status !== 200) throw new Error(`verify employer failed: ${res.status}`);
}

const contractListingBody = (over: Record<string, unknown> = {}) => ({
  categorySlug: 'electrician',
  title: 'Scam job: pay to apply',
  description: 'Send us a deposit to secure this role. Totally legitimate, trust us.',
  payType: 'DAILY',
  payAmountPaise: 150000,
  openings: 1,
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600042',
  ...over,
});

const campusListingBody = (over: Record<string, unknown> = {}) => ({
  categorySlug: 'electrician',
  title: 'Scam campus job',
  description: 'Send us a deposit to secure this role. Totally legitimate, trust us.',
  hourlyRatePaise: 15000,
  hoursPerWeek: 12,
  isNightShift: false,
  openings: 1,
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600042',
  ...over,
});

describe('review moderation (Phase 8, D-049)', () => {
  it('requires the DISPUTE_AGENT role (KYC_REVIEWER alone is not enough)', async () => {
    const kycOnly = await api.createAdmin(['KYC_REVIEWER']);
    const token = await api.adminToken(kycOnly);
    await api.adminGet(token, '/v1/admin/reviews').expect(403);
  });

  it('a SUPER_ADMIN can reach it too', async () => {
    const superAdmin = await api.createAdmin(['SUPER_ADMIN']);
    const token = await api.adminToken(superAdmin);
    await api.adminGet(token, '/v1/admin/reviews').expect(200);
  });

  it('lists reviews newest first, and can filter to one person', async () => {
    const { c, r, jobId } = await confirmedJob();
    await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 5, comment: 'Great!' }).expect(201);

    const all = await api.adminGet(agentToken, '/v1/admin/reviews');
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBeGreaterThan(0);

    const filtered = await api.adminGet(agentToken, `/v1/admin/reviews?revieweeId=${r.userId}`);
    expect(filtered.status).toBe(200);
    expect(
      filtered.body.items.some((i: { comment: string | null }) => i.comment === 'Great!'),
    ).toBe(true);
  });

  it('hiding a review reverses its rating out of WorkerStats and it disappears from the public list', async () => {
    const { c, r, jobId } = await confirmedJob();
    await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 5, comment: 'Fake praise' });

    const before = await m.prisma.workerStats.findUnique({ where: { workerUserId: r.userId } });
    expect(before?.ratingSum).toBe(5);
    expect(before?.ratingCount).toBe(1);

    const list = await api.adminGet(agentToken, `/v1/admin/reviews?revieweeId=${r.userId}`);
    const reviewId = list.body.items[0].id;

    const hidden = await api.adminPost(agentToken, `/v1/admin/reviews/${reviewId}/hide`, {
      reason: 'Reported as a fake/coordinated review',
    });
    expect(hidden.status).toBe(200);

    const after = await m.prisma.workerStats.findUnique({ where: { workerUserId: r.userId } });
    expect(after?.ratingSum).toBe(0);
    expect(after?.ratingCount).toBe(0);

    const publicList = await m.api.get(c, `/v1/rangers/${r.userId}/reviews`);
    expect(publicList.body.items).toHaveLength(0);

    const jobView = await m.api.get(c, `/v1/jobs/${jobId}`);
    expect(jobView.body.review.submitted).toBe(true); // still true: a real review was submitted
  });

  it('a short or missing reason is rejected', async () => {
    const { c, jobId } = await confirmedJob();
    await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 5 });
    const list = await api.adminGet(agentToken, '/v1/admin/reviews');
    const reviewId = list.body.items[0].id;
    const res = await api.adminPost(agentToken, `/v1/admin/reviews/${reviewId}/hide`, {
      reason: 'no',
    });
    expect(res.status).toBe(400);
  });

  it('cannot hide the same review twice', async () => {
    const { c, jobId } = await confirmedJob();
    await m.api.post(c, `/v1/jobs/${jobId}/review`, { rating: 5 });
    const list = await api.adminGet(agentToken, '/v1/admin/reviews');
    const reviewId = list.body.items[0].id;
    await api
      .adminPost(agentToken, `/v1/admin/reviews/${reviewId}/hide`, { reason: 'First takedown' })
      .expect(200);
    const again = await api.adminPost(agentToken, `/v1/admin/reviews/${reviewId}/hide`, {
      reason: 'Second attempt',
    });
    expect(again.status).toBe(409);
  });
});

describe('listing moderation (Phase 8, D-059)', () => {
  it('requires the DISPUTE_AGENT role', async () => {
    const kycOnly = await api.createAdmin(['KYC_REVIEWER']);
    const token = await api.adminToken(kycOnly);
    await api.adminGet(token, '/v1/admin/contract-listings').expect(403);
    await api.adminGet(token, '/v1/admin/campus-listings').expect(403);
  });

  it('browses and text-searches Contract listings by title', async () => {
    const emp = await employer();
    await verifyEmployer(emp.userId);
    const created = await api.post(emp, '/v1/employer/contracts', contractListingBody());
    expect(created.status).toBe(201);

    const browsed = await api.adminGet(agentToken, '/v1/admin/contract-listings?q=Scam');
    expect(browsed.status).toBe(200);
    expect(browsed.body.items.some((i: { id: string }) => i.id === created.body.id)).toBe(true);
  });

  it('cancelling a Contract listing takes it down and notifies the employer', async () => {
    const emp = await employer('Notify Co');
    await verifyEmployer(emp.userId);
    await api.patch(emp, '/v1/me/push-token', { deviceId: emp.deviceId, pushToken: 'emp-tok' });
    const created = await api.post(emp, '/v1/employer/contracts', contractListingBody());

    const before = api.push().outbox.length;
    const cancelled = await api.adminPost(
      agentToken,
      `/v1/admin/contract-listings/${created.body.id}/cancel`,
      { reason: 'Advance-fee scam reported by multiple applicants' },
    );
    expect(cancelled.status).toBe(200);

    const listing = await api.prisma().contractListing.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(listing.status).toBe('CANCELLED');

    const sent = api.push().outbox.slice(before);
    expect(sent.some((s) => s.tokens.includes('emp-tok'))).toBe(true);
  });

  it('cannot cancel an already-cancelled listing twice', async () => {
    const emp = await employer('Double Cancel Co');
    await verifyEmployer(emp.userId);
    const created = await api.post(emp, '/v1/employer/contracts', contractListingBody());
    await api
      .adminPost(agentToken, `/v1/admin/contract-listings/${created.body.id}/cancel`, {
        reason: 'First takedown reason',
      })
      .expect(200);
    const again = await api.adminPost(
      agentToken,
      `/v1/admin/contract-listings/${created.body.id}/cancel`,
      { reason: 'Second takedown attempt' },
    );
    expect(again.status).toBe(409);
  });

  it('browses and cancels Campus listings the same way', async () => {
    const emp = await employer('Campus Scam Co');
    await verifyEmployer(emp.userId);
    const created = await api.post(emp, '/v1/employer/campus', campusListingBody());
    expect(created.status).toBe(201);

    const browsed = await api.adminGet(agentToken, '/v1/admin/campus-listings?q=Scam');
    expect(browsed.body.items.some((i: { id: string }) => i.id === created.body.id)).toBe(true);

    const cancelled = await api.adminPost(
      agentToken,
      `/v1/admin/campus-listings/${created.body.id}/cancel`,
      { reason: 'Same advance-fee scam pattern' },
    );
    expect(cancelled.status).toBe(200);
    const listing = await api
      .prisma()
      .campusListing.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(listing.status).toBe('CANCELLED');
  });
});
