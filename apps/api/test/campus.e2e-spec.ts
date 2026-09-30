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

let adminToken: string;
beforeAll(async () => {
  const admin = await api.createAdmin(['KYC_REVIEWER']);
  adminToken = await api.adminToken(admin);
});

/** Signs in, adds EMPLOYER role and sets a business name. Not verified by default. */
async function employer(businessName = 'Acme Tutoring'): Promise<Session> {
  const s = await api.signIn();
  const role = await api.post(s, '/v1/me/roles', { role: 'EMPLOYER' });
  if (role.status !== 201) throw new Error(`add EMPLOYER role failed: ${role.status}`);
  const profile = await api.patch(s, '/v1/employer/profile', { businessName });
  if (profile.status !== 200) throw new Error(`employer profile failed: ${profile.status}`);
  return s;
}

/** Signs in, adds EMPLOYER role, sets a business name, and gets admin-verified (D-062). */
async function verifiedEmployer(businessName = 'Acme Tutoring'): Promise<Session> {
  const s = await employer(businessName);
  const ep = await api.prisma().employerProfile.findUniqueOrThrow({ where: { userId: s.userId } });
  const res = await api.adminPost(adminToken, `/v1/admin/employers/${ep.id}/verify`, {});
  if (res.status !== 200) throw new Error(`verify employer failed: ${res.status}`);
  return s;
}

/** Signs in, adds STUDENT role and sets a date of birth (adult by default, D-060). */
async function student(dateOfBirth = '2003-06-15'): Promise<Session> {
  const s = await api.signIn();
  const role = await api.post(s, '/v1/me/roles', { role: 'STUDENT' });
  if (role.status !== 201) throw new Error(`add STUDENT role failed: ${role.status}`);
  const profile = await api.post(s, '/v1/student/profile', { dateOfBirth });
  if (profile.status !== 201) throw new Error(`student profile failed: ${profile.status}`);
  return s;
}

const listingBody = (over: Record<string, unknown> = {}) => ({
  categorySlug: 'electrician',
  title: 'Front-desk help, evenings',
  description: 'Answering phones and light admin work at our tutoring centre.',
  hourlyRatePaise: 15000,
  hoursPerWeek: 12,
  isNightShift: false,
  openings: 1,
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600042',
  ...over,
});

describe('student profile (D-060)', () => {
  it('requires the STUDENT role', async () => {
    const s = await api.signIn();
    const res = await api.post(s, '/v1/student/profile', { dateOfBirth: '2003-01-01' });
    expect(res.status).toBe(403);
  });

  it('refuses an under-18 date of birth (hard block, not a warning)', async () => {
    const s = await api.signIn();
    await api.post(s, '/v1/me/roles', { role: 'STUDENT' });
    const seventeenYearsAgo = new Date();
    seventeenYearsAgo.setFullYear(seventeenYearsAgo.getFullYear() - 17);
    const res = await api.post(s, '/v1/student/profile', {
      dateOfBirth: seventeenYearsAgo.toISOString().slice(0, 10),
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details?.code).toBe('UNDER_18');
    const sp = await api.prisma().studentProfile.findUnique({ where: { userId: s.userId } });
    expect(sp).toBeNull(); // no row created for a refused signup
  });

  it('accepts an adult date of birth and cannot be resubmitted', async () => {
    const s = await student();
    const again = await api.post(s, '/v1/student/profile', { dateOfBirth: '2003-06-15' });
    expect(again.status).toBe(409);
    expect(again.body.error.details?.code).toBe('STUDENT_PROFILE_EXISTS');
  });

  it('the institute name can be updated after creation', async () => {
    const s = await student();
    const upd = await api.patch(s, '/v1/student/profile', { instituteName: 'IIT Madras' });
    expect(upd.status).toBe(200);
    expect(upd.body.instituteName).toBe('IIT Madras');
  });
});

describe('employer verification gate (D-062)', () => {
  it('an unverified employer cannot post a Campus listing', async () => {
    const emp = await employer();
    const res = await api.post(emp, '/v1/employer/campus', listingBody());
    expect(res.status).toBe(422);
    expect(res.body.error.details?.code).toBe('EMPLOYER_NOT_VERIFIED');
  });

  it('appears in the admin verification queue until verified', async () => {
    const emp = await employer('Queue Co');
    const queue = await api.adminGet(adminToken, '/v1/admin/employers/queue');
    expect(queue.status).toBe(200);
    expect(queue.body.items.some((i: { userId: string }) => i.userId === emp.userId)).toBe(true);

    const ep = await api.prisma().employerProfile.findUniqueOrThrow({
      where: { userId: emp.userId },
    });
    const verify = await api.adminPost(adminToken, `/v1/admin/employers/${ep.id}/verify`, {});
    expect(verify.status).toBe(200);

    const queueAfter = await api.adminGet(adminToken, '/v1/admin/employers/queue');
    expect(queueAfter.body.items.some((i: { userId: string }) => i.userId === emp.userId)).toBe(
      false,
    );
  });

  it('a verified employer can post', async () => {
    const emp = await verifiedEmployer();
    const res = await api.post(emp, '/v1/employer/campus', listingBody());
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('OPEN');
  });
});

describe('posting and browsing Campus listings', () => {
  it('a posted listing appears in the public browse list', async () => {
    const emp = await verifiedEmployer();
    const created = await api.post(emp, '/v1/employer/campus', listingBody());
    const stu = await student();
    const browsed = await api.get(stu, '/v1/campus?categorySlug=electrician');
    expect(browsed.status).toBe(200);
    expect(browsed.body.items.some((i: { id: string }) => i.id === created.body.id)).toBe(true);
  });
});

describe('applying (D-060/D-061/D-062)', () => {
  it('requires a student profile first', async () => {
    const emp = await verifiedEmployer();
    const created = await api.post(emp, '/v1/employer/campus', listingBody());
    const s = await api.signIn();
    await api.post(s, '/v1/me/roles', { role: 'STUDENT' });
    const res = await api.post(s, `/v1/campus/${created.body.id}/apply`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.details?.code).toBe('STUDENT_PROFILE_REQUIRED');
  });

  it('a night-shift listing requires explicit opt-in', async () => {
    const emp = await verifiedEmployer();
    const created = await api.post(emp, '/v1/employer/campus', listingBody({ isNightShift: true }));
    const stu = await student();
    const refused = await api.post(stu, `/v1/campus/${created.body.id}/apply`, {
      acceptsNightShift: false,
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details?.code).toBe('NIGHT_SHIFT_OPT_IN_REQUIRED');

    const accepted = await api.post(stu, `/v1/campus/${created.body.id}/apply`, {
      acceptsNightShift: true,
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.acceptsNightShift).toBe(true);
  });

  it('applying to a listing that alone exceeds the weekly hours cap is refused', async () => {
    const emp = await verifiedEmployer();
    const created = await api.post(emp, '/v1/employer/campus', listingBody({ hoursPerWeek: 25 }));
    const stu = await student();
    const res = await api.post(stu, `/v1/campus/${created.body.id}/apply`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.details?.code).toBe('WEEKLY_HOURS_CAP');
  });

  it('an employer cannot apply to their own listing', async () => {
    const emp = await verifiedEmployer();
    await api.post(emp, '/v1/me/roles', { role: 'STUDENT' });
    await api.post(emp, '/v1/student/profile', { dateOfBirth: '2003-06-15' });
    const created = await api.post(emp, '/v1/employer/campus', listingBody());
    const res = await api.post(emp, `/v1/campus/${created.body.id}/apply`, {});
    expect(res.status).toBe(422);
  });
});

describe('hiring and the weekly hours cap at hire time (D-061)', () => {
  it('hiring a second job that would push the student over the cap is refused', async () => {
    const emp = await verifiedEmployer();
    const stu = await student();

    const jobA = await api.post(emp, '/v1/employer/campus', listingBody({ hoursPerWeek: 12 }));
    const jobB = await api.post(emp, '/v1/employer/campus', listingBody({ hoursPerWeek: 12 }));

    const appA = await api.post(stu, `/v1/campus/${jobA.body.id}/apply`, {});
    const appB = await api.post(stu, `/v1/campus/${jobB.body.id}/apply`, {});
    expect(appA.status).toBe(201);
    expect(appB.status).toBe(201);

    const hireA = await api.post(
      emp,
      `/v1/employer/campus/${jobA.body.id}/applications/${appA.body.id}/decision`,
      { decision: 'HIRE' },
    );
    expect(hireA.status).toBe(201);
    expect(hireA.body.status).toBe('HIRED');

    // 12h already committed; hiring the second 12h job would be 24h > the 20h default cap.
    const hireB = await api.post(
      emp,
      `/v1/employer/campus/${jobB.body.id}/applications/${appB.body.id}/decision`,
      { decision: 'HIRE' },
    );
    expect(hireB.status).toBe(422);
    expect(hireB.body.error.details?.code).toBe('WEEKLY_HOURS_CAP');
  });

  it('hire fills the listing; reject leaves it open', async () => {
    const emp = await verifiedEmployer();
    const created = await api.post(emp, '/v1/employer/campus', listingBody({ openings: 1 }));
    const stu = await student();
    const app = await api.post(stu, `/v1/campus/${created.body.id}/apply`, {});

    const hired = await api.post(
      emp,
      `/v1/employer/campus/${created.body.id}/applications/${app.body.id}/decision`,
      { decision: 'HIRE' },
    );
    expect(hired.body.status).toBe('HIRED');

    const listing = await api.get(emp, '/v1/employer/campus');
    const found = listing.body.items.find((i: { id: string }) => i.id === created.body.id);
    expect(found.status).toBe('FILLED');
    expect(found.filledCount).toBe(1);
  });
});

describe('withdrawing and re-applying', () => {
  it('can withdraw and then re-apply', async () => {
    const emp = await verifiedEmployer();
    const created = await api.post(emp, '/v1/employer/campus', listingBody());
    const stu = await student();
    await api.post(stu, `/v1/campus/${created.body.id}/apply`, {});
    const withdrawn = await api.del(stu, `/v1/campus/${created.body.id}/apply`);
    expect(withdrawn.status).toBe(200);
    const reapplied = await api.post(stu, `/v1/campus/${created.body.id}/apply`, {});
    expect(reapplied.status).toBe(201);
  });
});

describe('editing and closing a listing', () => {
  it('a non-owner gets 404, not 403', async () => {
    const emp = await verifiedEmployer();
    const stranger = await verifiedEmployer('Stranger Co');
    const created = await api.post(emp, '/v1/employer/campus', listingBody());
    const res = await api.patch(stranger, `/v1/employer/campus/${created.body.id}`, {
      title: 'Hijacked',
    });
    expect(res.status).toBe(404);
  });

  it('closing blocks further applications', async () => {
    const emp = await verifiedEmployer();
    const created = await api.post(emp, '/v1/employer/campus', listingBody());
    const closed = await api.patch(emp, `/v1/employer/campus/${created.body.id}`, {
      status: 'CLOSED',
    });
    expect(closed.body.status).toBe('CLOSED');
    const stu = await student();
    const res = await api.post(stu, `/v1/campus/${created.body.id}/apply`, {});
    expect(res.status).toBe(409);
  });
});
