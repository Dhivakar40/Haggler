import type { INestApplication } from '@nestjs/common';
import { Api, type Session } from './helpers';
import { type Harness, startHarness } from './harness';

let h: Harness;
let app: INestApplication;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  app = h.app;
  api = new Api(app);
});
afterAll(async () => {
  await h?.stop();
});

/** Signs in, adds EMPLOYER role and sets a business name. */
async function employer(businessName = 'Acme Renovations'): Promise<Session> {
  const s = await api.signIn();
  const role = await api.post(s, '/v1/me/roles', { role: 'EMPLOYER' });
  if (role.status !== 201) throw new Error(`add EMPLOYER role failed: ${role.status}`);
  const profile = await api.patch(s, '/v1/employer/profile', { businessName });
  if (profile.status !== 200) throw new Error(`employer profile failed: ${profile.status}`);
  return s;
}

/** Signs in, adds WORKER role and sets kycTier so the account is contract-application-eligible
 * (the same identity-verification gate that blocks under-18 Rangers — D-054). */
async function verifiedWorker(kycTier = 1): Promise<Session> {
  const s = await api.signIn();
  const role = await api.post(s, '/v1/me/roles', { role: 'WORKER' });
  if (role.status !== 201) throw new Error(`add WORKER role failed: ${role.status}`);
  await api.prisma().workerProfile.update({ where: { userId: s.userId }, data: { kycTier } });
  return s;
}

const listingBody = (over: Record<string, unknown> = {}) => ({
  categorySlug: 'electrician',
  title: 'Site electrician needed for 2-month fit-out',
  description: 'Rewiring a 3-floor office. Own tools required. Daily rate negotiable.',
  payType: 'DAILY',
  payAmountPaise: 150000,
  openings: 2,
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600042',
  ...over,
});

describe('employer profile', () => {
  it('requires the EMPLOYER role', async () => {
    const s = await api.signIn(); // no roles added
    const res = await api.patch(s, '/v1/employer/profile', { businessName: 'Nope Inc' });
    expect(res.status).toBe(403);
  });

  it('creates and updates a business name', async () => {
    const s = await employer('First Name Co');
    const got = await api.get(s, '/v1/employer/profile');
    expect(got.body.businessName).toBe('First Name Co');
    const upd = await api.patch(s, '/v1/employer/profile', { businessName: 'Renamed Co' });
    expect(upd.body.businessName).toBe('Renamed Co');
  });
});

describe('posting and browsing listings', () => {
  it('cannot post without an employer profile first', async () => {
    const s = await api.signIn();
    await api.post(s, '/v1/me/roles', { role: 'EMPLOYER' });
    const res = await api.post(s, '/v1/employer/contracts', listingBody());
    expect(res.status).toBe(422);
    expect(res.body.error.details?.code).toBe('EMPLOYER_PROFILE_REQUIRED');
  });

  it('posts a listing and it appears in the public browse list', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('OPEN');
    expect(created.body.filledCount).toBe(0);
    expect(created.body.businessName).toBe('Acme Renovations');

    const worker = await verifiedWorker();
    const browsed = await api.get(worker, '/v1/contracts?categorySlug=electrician');
    expect(browsed.status).toBe(200);
    expect(browsed.body.items.some((i: { id: string }) => i.id === created.body.id)).toBe(true);
  });

  it('filters by city and pay type', async () => {
    const emp = await employer();
    await api.post(emp, '/v1/employer/contracts', listingBody({ city: 'Nowhereville' }));
    const worker = await verifiedWorker();
    const res = await api.get(worker, '/v1/contracts?city=Nowhereville');
    expect(res.body.items.every((i: { city: string }) => i.city === 'Nowhereville')).toBe(true);
  });

  it('a listing appears in employer/contracts (mine) with an application count', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const mine = await api.get(emp, '/v1/employer/contracts');
    const found = mine.body.items.find((i: { id: string }) => i.id === created.body.id);
    expect(found.applicationCount).toBe(0);
  });

  it('rejects an unknown category', async () => {
    const emp = await employer();
    const res = await api.post(
      emp,
      '/v1/employer/contracts',
      listingBody({ categorySlug: 'nope' }),
    );
    expect(res.status).toBe(422);
  });
});

describe('applying', () => {
  it('requires kycTier >= 1 (the under-18 / identity gate)', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const worker = await verifiedWorker(0);
    const res = await api.post(worker, `/v1/contracts/${created.body.id}/apply`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.details?.code).toBe('KYC_REQUIRED');
  });

  it('an employer cannot apply to their own listing', async () => {
    const emp = await employer();
    await api.post(emp, '/v1/me/roles', { role: 'WORKER' });
    await api
      .prisma()
      .workerProfile.update({ where: { userId: emp.userId }, data: { kycTier: 2 } });
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const res = await api.post(emp, `/v1/contracts/${created.body.id}/apply`, {});
    expect(res.status).toBe(422);
  });

  it('applies with a cover note, and the employer sees it', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const worker = await verifiedWorker();
    const applied = await api.post(worker, `/v1/contracts/${created.body.id}/apply`, {
      coverNote: 'I did the Anna Nagar office rewiring last year.',
    });
    expect(applied.status).toBe(201);
    expect(applied.body.status).toBe('APPLIED');

    const apps = await api.get(emp, `/v1/employer/contracts/${created.body.id}/applications`);
    expect(apps.body.items).toHaveLength(1);
    expect(apps.body.items[0].coverNote).toMatch(/Anna Nagar/);
  });

  it('cannot apply twice', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const worker = await verifiedWorker();
    await api.post(worker, `/v1/contracts/${created.body.id}/apply`, {});
    const again = await api.post(worker, `/v1/contracts/${created.body.id}/apply`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.details?.code).toBe('ALREADY_APPLIED');
  });

  it('can withdraw and then re-apply', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const worker = await verifiedWorker();
    await api.post(worker, `/v1/contracts/${created.body.id}/apply`, {});
    const withdrawn = await api.del(worker, `/v1/contracts/${created.body.id}/apply`);
    expect(withdrawn.status).toBe(200);
    const reapplied = await api.post(worker, `/v1/contracts/${created.body.id}/apply`, {});
    expect(reapplied.status).toBe(201);
    expect(reapplied.body.status).toBe('APPLIED');
  });

  it('shows up in my own applications list with the listing summary', async () => {
    const emp = await employer('Summary Co');
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const worker = await verifiedWorker();
    await api.post(worker, `/v1/contracts/${created.body.id}/apply`, {});
    const mine = await api.get(worker, '/v1/me/contract-applications');
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].businessName).toBe('Summary Co');
    expect(mine.body.items[0].listingTitle).toBe(listingBody().title);
  });

  it('browsing shows my application status on the listing (myApplicationStatus)', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const worker = await verifiedWorker();
    await api.post(worker, `/v1/contracts/${created.body.id}/apply`, {});
    const browsed = await api.get(worker, '/v1/contracts?categorySlug=electrician');
    const found = browsed.body.items.find((i: { id: string }) => i.id === created.body.id);
    expect(found.myApplicationStatus).toBe('APPLIED');
  });
});

describe('deciding on applicants', () => {
  it('shortlist -> hire fills the listing and blocks further applications', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody({ openings: 1 }));
    const w1 = await verifiedWorker();
    const app1 = await api.post(w1, `/v1/contracts/${created.body.id}/apply`, {});

    const shortlisted = await api.post(
      emp,
      `/v1/employer/contracts/${created.body.id}/applications/${app1.body.id}/decision`,
      { decision: 'SHORTLIST' },
    );
    expect(shortlisted.status).toBe(201);
    expect(shortlisted.body.status).toBe('SHORTLISTED');

    const hired = await api.post(
      emp,
      `/v1/employer/contracts/${created.body.id}/applications/${app1.body.id}/decision`,
      { decision: 'HIRE' },
    );
    expect(hired.status).toBe(201);
    expect(hired.body.status).toBe('HIRED');

    const listing = await api.get(emp, `/v1/employer/contracts`);
    const found = listing.body.items.find((i: { id: string }) => i.id === created.body.id);
    expect(found.status).toBe('FILLED');
    expect(found.filledCount).toBe(1);

    // A second worker can no longer apply once the listing is filled.
    const w2 = await verifiedWorker();
    const res = await api.post(w2, `/v1/contracts/${created.body.id}/apply`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.details?.code).toBe('LISTING_CLOSED');
  });

  it('reject leaves the listing open and does not increment filledCount', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const w1 = await verifiedWorker();
    const app1 = await api.post(w1, `/v1/contracts/${created.body.id}/apply`, {});
    const rejected = await api.post(
      emp,
      `/v1/employer/contracts/${created.body.id}/applications/${app1.body.id}/decision`,
      { decision: 'REJECT' },
    );
    expect(rejected.body.status).toBe('REJECTED');
    const listing = await api.get(emp, '/v1/employer/contracts');
    const found = listing.body.items.find((i: { id: string }) => i.id === created.body.id);
    expect(found.status).toBe('OPEN');
    expect(found.filledCount).toBe(0);
  });

  it('a rejected worker cannot re-apply', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const w1 = await verifiedWorker();
    const app1 = await api.post(w1, `/v1/contracts/${created.body.id}/apply`, {});
    await api.post(
      emp,
      `/v1/employer/contracts/${created.body.id}/applications/${app1.body.id}/decision`,
      { decision: 'REJECT' },
    );
    const res = await api.post(w1, `/v1/contracts/${created.body.id}/apply`, {});
    expect(res.status).toBe(409);
  });

  it('another employer cannot decide on (or even see) applications for a listing they do not own', async () => {
    const emp = await employer();
    const stranger = await employer('Stranger Co');
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const w1 = await verifiedWorker();
    const app1 = await api.post(w1, `/v1/contracts/${created.body.id}/apply`, {});

    const strangerView = await api.get(
      stranger,
      `/v1/employer/contracts/${created.body.id}/applications`,
    );
    expect(strangerView.status).toBe(404);

    const strangerDecide = await api.post(
      stranger,
      `/v1/employer/contracts/${created.body.id}/applications/${app1.body.id}/decision`,
      { decision: 'HIRE' },
    );
    expect(strangerDecide.status).toBe(404);
  });

  it('cannot hire after a decision was already made', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const w1 = await verifiedWorker();
    const app1 = await api.post(w1, `/v1/contracts/${created.body.id}/apply`, {});
    await api.post(
      emp,
      `/v1/employer/contracts/${created.body.id}/applications/${app1.body.id}/decision`,
      { decision: 'REJECT' },
    );
    const again = await api.post(
      emp,
      `/v1/employer/contracts/${created.body.id}/applications/${app1.body.id}/decision`,
      { decision: 'HIRE' },
    );
    expect(again.status).toBe(409);
    expect(again.body.error.details?.code).toBe('DECISION_ALREADY_MADE');
  });
});

describe('editing and closing a listing', () => {
  it('an owner can edit an OPEN listing', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const edited = await api.patch(emp, `/v1/employer/contracts/${created.body.id}`, {
      title: 'Updated title',
      payAmountPaise: 200000,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe('Updated title');
    expect(edited.body.payAmountPaise).toBe(200000);
  });

  it('a non-owner gets 404, not 403 (never reveals the listing exists to a stranger)', async () => {
    const emp = await employer();
    const stranger = await employer('Stranger Co 2');
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const res = await api.patch(stranger, `/v1/employer/contracts/${created.body.id}`, {
      title: 'Hijacked',
    });
    expect(res.status).toBe(404);
  });

  it('closing a listing blocks further applications and edits', async () => {
    const emp = await employer();
    const created = await api.post(emp, '/v1/employer/contracts', listingBody());
    const closed = await api.patch(emp, `/v1/employer/contracts/${created.body.id}`, {
      status: 'CLOSED',
    });
    expect(closed.body.status).toBe('CLOSED');

    const worker = await verifiedWorker();
    const applyRes = await api.post(worker, `/v1/contracts/${created.body.id}/apply`, {});
    expect(applyRes.status).toBe(409);

    const editRes = await api.patch(emp, `/v1/employer/contracts/${created.body.id}`, {
      title: 'Too late',
    });
    expect(editRes.status).toBe(422);
    expect(editRes.body.error.details?.code).toBe('LISTING_NOT_EDITABLE');
  });
});
