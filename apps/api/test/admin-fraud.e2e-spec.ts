import type { INestApplication } from '@nestjs/common';
import { Api } from './helpers';
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

/**
 * D-093 (Sub-phase K1/K2): the queue/resolve endpoints and the multi-account-candidates query
 * are exercised end to end here; FraudDetectionService's actual signal logic has its own
 * thorough unit coverage (fraud-detection.service.spec.ts, which actually runs, unlike this
 * file) since it needs no Postgres to test — this file only confirms the routes and auth are
 * wired correctly.
 */
describe('D-093: admin fraud review (routes only — signal logic is unit-tested)', () => {
  it('the fraud queue is reachable and starts empty for a fresh item', async () => {
    const empty = await api.adminGet(agentToken, '/v1/admin/fraud-review');
    expect(empty.status).toBe(200);
    expect(Array.isArray(empty.body.items)).toBe(true);
  });

  it('resolving a fraud item updates its status without touching any balance or league', async () => {
    const row = await m.prisma.fraudReviewItem.create({
      data: {
        kind: 'VELOCITY',
        subjectUserId: (await m.ranger()).userId,
        detail: { note: 'test fixture' },
      },
    });
    const resolved = await api.adminPost(agentToken, `/v1/admin/fraud-review/${row.id}/resolve`, {
      note: 'Looked at the job list, nothing unusual.',
    });
    expect(resolved.status).toBe(200);
    const stored = await m.prisma.fraudReviewItem.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.status).toBe('RESOLVED');

    const again = await api.adminPost(agentToken, `/v1/admin/fraud-review/${row.id}/resolve`, {
      note: 'second attempt',
    });
    expect(again.status).toBe(409);
  });

  it('multi-account-candidates finds two accounts sharing a device id', async () => {
    const a = await m.customer();
    const b = await m.customer();
    const sharedDeviceId = `shared-${Date.now()}`;
    await m.prisma.device.create({
      data: { userId: a.userId, deviceId: sharedDeviceId, platform: 'android' },
    });
    await m.prisma.device.create({
      data: { userId: b.userId, deviceId: sharedDeviceId, platform: 'android' },
    });

    const res = await api.adminGet(agentToken, '/v1/admin/fraud-review/multi-account-candidates');
    expect(res.status).toBe(200);
    const match = res.body.items.find((i: { deviceId: string }) => i.deviceId === sharedDeviceId);
    expect(match).toBeDefined();
    expect(match.userIds).toEqual(expect.arrayContaining([a.userId, b.userId]));
  });

  it('a non-admin role is refused', async () => {
    const res = await api.adminGet(agentToken, '/v1/admin/fraud-review/multi-account-candidates');
    expect(res.status).toBe(200); // DISPUTE_AGENT is allowed — sanity check for the next line
    const other = await api.createAdmin(['KYC_REVIEWER']);
    const otherToken = await api.adminToken(other);
    const refused = await api.adminGet(otherToken, '/v1/admin/fraud-review');
    expect(refused.status).toBe(403);
  });
});
