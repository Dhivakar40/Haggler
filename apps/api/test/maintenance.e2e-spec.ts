import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { QueuesService } from '../src/maintenance/queues.service';
import { type Harness, startHarness } from './harness';
import { Market, northOf } from './market-helpers';

let h: Harness;
let m: Market;

beforeAll(async () => {
  h = await startHarness();
  m = new Market(h.app);
});
afterAll(async () => {
  await h?.stop();
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('retention jobs', () => {
  it('trim-auth-data deletes OTP attempts and dead refresh tokens older than 30 days, and nothing newer', async () => {
    const s = await m.api.signIn(); // creates a fresh OTP row and a live refresh token
    const oldOtp = await m.prisma.otpAttempt.create({
      data: {
        phone: '+919800000001',
        codeHash: 'x'.repeat(64),
        expiresAt: daysAgo(40),
        createdAt: daysAgo(40),
      },
    });
    const recentOtp = await m.prisma.otpAttempt.create({
      data: {
        phone: '+919800000002',
        codeHash: 'y'.repeat(64),
        expiresAt: daysAgo(1),
        createdAt: daysAgo(2),
      },
    });
    const expiredToken = await m.prisma.refreshToken.create({
      data: {
        userId: s.userId,
        tokenHash: 'a'.repeat(64),
        familyId: '11111111-1111-4111-8111-111111111111',
        expiresAt: daysAgo(31),
      },
    });
    const revokedOld = await m.prisma.refreshToken.create({
      data: {
        userId: s.userId,
        tokenHash: 'b'.repeat(64),
        familyId: '22222222-2222-4222-8222-222222222222',
        expiresAt: daysAgo(-10),
        revokedAt: daysAgo(35),
      },
    });
    const revokedRecent = await m.prisma.refreshToken.create({
      data: {
        userId: s.userId,
        tokenHash: 'c'.repeat(64),
        familyId: '33333333-3333-4333-8333-333333333333',
        expiresAt: daysAgo(-10),
        revokedAt: daysAgo(3),
      },
    });

    const removed = await h.app.get(MaintenanceService).run('trim-auth-data');
    expect(removed).toBe(3); // old OTP + expired token + long-revoked token

    expect(await m.prisma.otpAttempt.findUnique({ where: { id: oldOtp.id } })).toBeNull();
    expect(await m.prisma.otpAttempt.findUnique({ where: { id: recentOtp.id } })).not.toBeNull();
    expect(await m.prisma.refreshToken.findUnique({ where: { id: expiredToken.id } })).toBeNull();
    expect(await m.prisma.refreshToken.findUnique({ where: { id: revokedOld.id } })).toBeNull();
    expect(
      await m.prisma.refreshToken.findUnique({ where: { id: revokedRecent.id } }),
    ).not.toBeNull();
    expect(
      await m.prisma.refreshToken.count({
        where: { userId: s.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ).toBe(1); // the live session survives
    expect(await h.app.get(MaintenanceService).run('trim-auth-data')).toBe(0); // idempotent
  });

  it('trim-gps-trails deletes trails of jobs that ended over 90 days ago, never active or recent ones', async () => {
    const area = { lat: 9.9, lng: 78.1 };
    const mk = async () => {
      const c = await m.customer({ at: area });
      const r = await m.ranger({ at: northOf(200, area) });
      const { jobId } = await m.match(c, r);
      await m.agree(c, r, jobId);
      await m.api.post(r, `/v1/jobs/${jobId}/en-route`);
      await m.ping(r, northOf(1000, area));
      return { c, r, jobId };
    };
    const old = await mk();
    const active = await mk();
    await m.api.post(old.c, `/v1/jobs/${old.jobId}/cancel`, {}); // terminal
    await m.prisma
      .$executeRaw`UPDATE jobs SET updated_at = now() - interval '100 days' WHERE id = ${old.jobId}::uuid`;
    expect(await m.prisma.jobLocation.count({ where: { jobId: old.jobId } })).toBeGreaterThan(0);

    const removed = await h.app.get(MaintenanceService).run('trim-gps-trails');
    expect(removed).toBeGreaterThan(0);
    expect(await m.prisma.jobLocation.count({ where: { jobId: old.jobId } })).toBe(0);
    expect(await m.prisma.jobLocation.count({ where: { jobId: active.jobId } })).toBeGreaterThan(0); // still needed
  });

  it('purge-kyc-images and purge-accounts run through the same entry point', async () => {
    const svc = h.app.get(MaintenanceService);
    expect(await svc.run('purge-kyc-images')).toBe(0);
    expect(await svc.run('purge-accounts')).toBe(0);
  });
});

describe('BullMQ scheduling', () => {
  it('registers the four recurring jobs and runs a job through a real Redis-backed worker', async () => {
    const app = await h.createApp({ QUEUES_ENABLED: 'true' });
    try {
      const queues = app.get(QueuesService);
      const schedulers = await queues.schedulers();
      expect(schedulers.map((s) => s.name).sort()).toEqual([
        'purge-accounts',
        'purge-kyc-images',
        'trim-auth-data',
        'trim-gps-trails',
      ]);
      expect(schedulers.find((s) => s.name === 'purge-accounts')?.pattern).toBe('30 2 * * *');

      await m.prisma.otpAttempt.create({
        data: {
          phone: '+919800000009',
          codeHash: 'z'.repeat(64),
          expiresAt: daysAgo(50),
          createdAt: daysAgo(50),
        },
      });
      const job = await queues.enqueue('trim-auth-data');
      expect(job).toBeTruthy();
      let state = '';
      for (let i = 0; i < 100 && state !== 'completed'; i++) {
        await new Promise((r) => setTimeout(r, 100));
        state = (await job!.getState()) as string;
      }
      expect(state).toBe('completed');
      const done = await job!.getState();
      expect(done).toBe('completed');
      expect(await queues.failedCount()).toBe(0);
      expect(await m.prisma.otpAttempt.count({ where: { phone: '+919800000009' } })).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('the API still boots (queues off) when asked not to run them', async () => {
    const queues = h.app.get(QueuesService);
    expect(await queues.schedulers()).toEqual([]);
    expect(await queues.enqueue('trim-auth-data')).toBeUndefined();
  });
});
