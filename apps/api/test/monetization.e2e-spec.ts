import type { INestApplication } from '@nestjs/common';
import { Api, type Session } from './helpers';
import { type Harness, startHarness } from './harness';
import { Market } from './market-helpers';

let h: Harness;
let app: INestApplication;
let api: Api;
let m: Market;

beforeAll(async () => {
  h = await startHarness();
  app = h.app;
  api = new Api(app);
  m = new Market(app);
});
afterAll(async () => {
  await h?.stop();
});

/** Signs in, adds EMPLOYER role and sets a business name (mirrors contracts.e2e-spec.ts). */
async function employer(businessName = 'Acme Boosts'): Promise<Session> {
  const s = await api.signIn();
  const role = await api.post(s, '/v1/me/roles', { role: 'EMPLOYER' });
  if (role.status !== 201) throw new Error(`add EMPLOYER role failed: ${role.status}`);
  const profile = await api.patch(s, '/v1/employer/profile', { businessName });
  if (profile.status !== 200) throw new Error(`employer profile failed: ${profile.status}`);
  return s;
}

async function subscribePlus(s: Session, slug: string): Promise<void> {
  const plans = await api.get(
    s,
    `/v1/plus/plans?audience=${slug === 'plus-employer-monthly' ? 'EMPLOYER' : 'CUSTOMER'}`,
  );
  const plan = plans.body.find((p: { slug: string }) => p.slug === slug);
  if (!plan) throw new Error(`plan ${slug} not seeded`);
  const order = await api.post(s, '/v1/wallet/plus/subscribe', { planId: plan.id });
  if (order.status !== 201) throw new Error(`subscribe order failed: ${order.status}`);
  const pay = await api.post(s, `/v1/wallet/orders/${order.body.orderId}/sandbox-pay`, {});
  if (pay.status !== 200) throw new Error(`subscribe sandbox-pay failed: ${pay.status}`);
}

const contractListingBody = (over: Record<string, unknown> = {}) => ({
  categorySlug: 'electrician',
  title: 'Boost me: site electrician needed',
  description: 'Rewiring a 3-floor office. Own tools required. Daily rate negotiable.',
  payType: 'DAILY',
  payAmountPaise: 150000,
  openings: 1,
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600042',
  ...over,
});

describe('Haggler Plus: subscription, discount, priority broadcast (Phase 9, D-069)', () => {
  it('lists CUSTOMER and EMPLOYER plans separately', async () => {
    const s = await api.signIn();
    const customerPlans = await api.get(s, '/v1/plus/plans?audience=CUSTOMER');
    const employerPlans = await api.get(s, '/v1/plus/plans?audience=EMPLOYER');
    expect(customerPlans.body.every((p: { audience: string }) => p.audience === 'CUSTOMER')).toBe(
      true,
    );
    expect(employerPlans.body.every((p: { audience: string }) => p.audience === 'EMPLOYER')).toBe(
      true,
    );
    expect(customerPlans.body.length).toBeGreaterThan(0);
    expect(employerPlans.body.length).toBeGreaterThan(0);
  });

  it('a fresh account has no membership', async () => {
    const s = await api.signIn();
    const membership = await api.get(s, '/v1/plus/membership').expect(200);
    // A controller returning `null` sends an empty body, not the literal text "null"; the mobile
    // client already treats an empty body as `null` (apiRequest: `text ? JSON.parse(text) : null`,
    // same as the admin app's api() helper) so this is the real, already-handled wire shape.
    expect(membership.text).toBe('');
  });

  it('subscribing grants an active membership that expires ~30 days out', async () => {
    const s = await api.signIn();
    const before = Date.now();
    await subscribePlus(s, 'plus-customer-monthly');
    const membership = await api.get(s, '/v1/plus/membership').expect(200);
    expect(membership.body.active).toBe(true);
    expect(membership.body.planSlug).toBe('plus-customer-monthly');
    const expiresAt = new Date(membership.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(before + 29 * 86_400_000);
    expect(expiresAt).toBeLessThan(before + 31 * 86_400_000);
  });

  it('renewing while still active extends from the current expiry, not from now', async () => {
    const s = await api.signIn();
    await subscribePlus(s, 'plus-customer-monthly');
    const first = (await api.get(s, '/v1/plus/membership').expect(200)).body;
    await subscribePlus(s, 'plus-customer-monthly');
    const second = (await api.get(s, '/v1/plus/membership').expect(200)).body;
    const gainedDays =
      (new Date(second.expiresAt).getTime() - new Date(first.expiresAt).getTime()) / 86_400_000;
    expect(gainedDays).toBeGreaterThan(29);
    expect(gainedDays).toBeLessThan(31);
  });

  it('discounts token bundle prices while Plus is active, and un-discounts once it lapses', async () => {
    const s = await api.signIn();
    const before = await api.get(s, '/v1/wallet/bundles').expect(200);
    const fullPrice = before.body[0].pricePaise;

    await subscribePlus(s, 'plus-customer-monthly');
    const during = await api.get(s, '/v1/wallet/bundles').expect(200);
    expect(during.body[0].pricePaise).toBeLessThan(fullPrice);
    // Seeded at 1000 bps (10%).
    expect(during.body[0].pricePaise).toBe(Math.round((fullPrice * 9000) / 10_000));

    await api
      .prisma()
      .plusMembership.update({ where: { userId: s.userId }, data: { expiresAt: new Date(0) } });
    const after = await api.get(s, '/v1/wallet/bundles').expect(200);
    expect(after.body[0].pricePaise).toBe(fullPrice);
  });

  it('a request created while Plus is active is rush from the start (priority broadcast)', async () => {
    const c = await m.customer({ tokens: 5 });
    await subscribePlus(c, 'plus-customer-monthly');
    const { jobId } = await m.open(c);
    const job = await api.get(c, `/v1/jobs/${jobId}`).expect(200);
    expect(job.body.isRush).toBe(true);
  });

  it('a request created without Plus is not rush', async () => {
    const c = await m.customer({ tokens: 5 });
    const { jobId } = await m.open(c);
    const job = await api.get(c, `/v1/jobs/${jobId}`).expect(200);
    expect(job.body.isRush).toBe(false);
  });
});

describe('Rush fee: skip wave sequencing on one request (Phase 9, D-069)', () => {
  it('paying the rush fee marks the job rush and jumps straight to the widest radius', async () => {
    const c = await m.customer({ tokens: 5 });
    const { requestId, jobId } = await m.open(c);
    const before = await api.get(c, `/v1/jobs/${jobId}`).expect(200);
    expect(before.body.isRush).toBe(false);

    const order = await api.post(c, `/v1/requests/${requestId}/rush`, {}).expect(201);
    expect(order.body.purpose).toBe('RUSH_FEE');
    await api.post(c, `/v1/wallet/orders/${order.body.orderId}/sandbox-pay`, {}).expect(200);

    const job = await api.prisma().job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.isRush).toBe(true);
  });

  it('cannot rush a request that is already rush', async () => {
    const c = await m.customer({ tokens: 5 });
    const { requestId } = await m.open(c);
    const order = await api.post(c, `/v1/requests/${requestId}/rush`, {}).expect(201);
    await api.post(c, `/v1/wallet/orders/${order.body.orderId}/sandbox-pay`, {}).expect(200);
    const again = await api.post(c, `/v1/requests/${requestId}/rush`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.details.code).toBe('ALREADY_RUSH');
  });

  it('cannot rush a request that is no longer broadcasting (already matched)', async () => {
    const area = { lat: 13.09, lng: 80.27 };
    const c = await m.customer({ at: area, tokens: 5 });
    const r = await m.ranger({ at: area });
    const { requestId } = await m.match(c, r);
    const res = await api.post(c, `/v1/requests/${requestId}/rush`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('NOT_BROADCASTING');
  });

  it("another customer cannot pay to rush someone else's request", async () => {
    const c = await m.customer({ tokens: 5 });
    const stranger = await m.customer({ tokens: 5 });
    const { requestId } = await m.open(c);
    await api.post(stranger, `/v1/requests/${requestId}/rush`, {}).expect(404);
  });
});

describe('Boosted listing fee: higher placement for Contract listings (Phase 9, D-069)', () => {
  it('boosting an OPEN listing surfaces it in the boosted section of browse()', async () => {
    const emp = await employer();
    const created = await api
      .post(emp, '/v1/employer/contracts', contractListingBody())
      .expect(201);
    expect(created.body.isBoosted).toBe(false);

    const order = await api.post(emp, `/v1/employer/contracts/${created.body.id}/boost`, {});
    expect(order.status).toBe(201);
    expect(order.body.purpose).toBe('BOOSTED_LISTING');
    await api.post(emp, `/v1/wallet/orders/${order.body.orderId}/sandbox-pay`, {}).expect(200);

    const browse = await api.get(emp, '/v1/contracts').expect(200);
    expect(browse.body.boosted.some((l: { id: string }) => l.id === created.body.id)).toBe(true);

    const detail = await api.get(emp, `/v1/contracts/${created.body.id}`).expect(200);
    expect(detail.body.isBoosted).toBe(true);
  });

  it('cannot boost a listing you do not own', async () => {
    const owner = await employer('Owner Co');
    const stranger = await employer('Stranger Co');
    const created = await api
      .post(owner, '/v1/employer/contracts', contractListingBody())
      .expect(201);
    await api.post(stranger, `/v1/employer/contracts/${created.body.id}/boost`, {}).expect(404);
  });

  it('cannot boost a listing that is not OPEN', async () => {
    const emp = await employer();
    const created = await api
      .post(emp, '/v1/employer/contracts', contractListingBody())
      .expect(201);
    await api
      .patch(emp, `/v1/employer/contracts/${created.body.id}`, { status: 'CLOSED' })
      .expect(200);
    const res = await api.post(emp, `/v1/employer/contracts/${created.body.id}/boost`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('LISTING_NOT_BOOSTABLE');
  });

  it('cannot boost an already-boosted listing (no stacking)', async () => {
    const emp = await employer();
    const created = await api
      .post(emp, '/v1/employer/contracts', contractListingBody())
      .expect(201);
    const order = await api.post(emp, `/v1/employer/contracts/${created.body.id}/boost`, {});
    await api.post(emp, `/v1/wallet/orders/${order.body.orderId}/sandbox-pay`, {}).expect(200);
    const again = await api.post(emp, `/v1/employer/contracts/${created.body.id}/boost`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.details.code).toBe('ALREADY_BOOSTED');
  });
});
