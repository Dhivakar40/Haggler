import type { INestApplication } from '@nestjs/common';
import { type Harness, startHarness } from './harness';
import { CENTER, Market } from './market-helpers';

/**
 * Phase 5: push registration and the push-on-disconnected-socket path. These tests never connect
 * a real socket, so every push-eligible event should fire a sandbox push (RealtimeService treats
 * "no socket" the same as "app backgrounded" — see realtime.service.ts).
 */
let h: Harness;
let app: INestApplication;
let m: Market;

beforeAll(async () => {
  h = await startHarness();
  app = h.app;
  m = new Market(app);
});
afterAll(async () => {
  await h?.stop();
});

describe('push token registration', () => {
  it('registers a token on my own device and it can be updated', async () => {
    const c = await m.customer();
    const res = await m.api.patch(c, '/v1/me/push-token', {
      deviceId: c.deviceId,
      pushToken: 'token-one',
    });
    expect(res.status).toBe(200);
    const device = await m.prisma.device.findUnique({
      where: { userId_deviceId: { userId: c.userId, deviceId: c.deviceId } },
    });
    expect(device?.pushToken).toBe('token-one');

    // Re-registering (e.g. a token refresh) overwrites it.
    await m.api.patch(c, '/v1/me/push-token', { deviceId: c.deviceId, pushToken: 'token-two' });
    const again = await m.prisma.device.findUnique({
      where: { userId_deviceId: { userId: c.userId, deviceId: c.deviceId } },
    });
    expect(again?.pushToken).toBe('token-two');
  });

  it("cannot attach a token to someone else's device id (silently does nothing)", async () => {
    const a = await m.customer();
    const b = await m.customer();
    const res = await m.api.patch(a, '/v1/me/push-token', {
      deviceId: b.deviceId, // a's own device id is different; this guesses b's
      pushToken: 'should-not-attach',
    });
    expect(res.status).toBe(200); // still 200: no information leak about whether the id exists
    const bDevice = await m.prisma.device.findUnique({
      where: { userId_deviceId: { userId: b.userId, deviceId: b.deviceId } },
    });
    expect(bDevice?.pushToken).toBeNull();
  });

  it('rejects an empty push token', async () => {
    const c = await m.customer();
    const res = await m.api.patch(c, '/v1/me/push-token', { deviceId: c.deviceId, pushToken: '' });
    expect(res.status).toBe(400);
  });
});

describe('push notifications fire alongside realtime events', () => {
  it('a broadcast invitation reaches a Ranger with no socket connected, via push', async () => {
    const c = await m.customer();
    const r = await m.ranger({ at: CENTER });
    await m.api.patch(r, '/v1/me/push-token', { deviceId: r.deviceId, pushToken: 'ranger-tok' });
    const before = m.api.push().outbox.length;

    const opened = await m.open(c);

    const sent = m.api.push().outbox.slice(before);
    expect(sent.some((s) => s.tokens.includes('ranger-tok'))).toBe(true);
    const one = sent.find((s) => s.tokens.includes('ranger-tok'))!;
    expect(one.message.data?.type).toBe('broadcast');
    expect(one.message.data?.jobId).toBe(opened.jobId);
  });

  it('a matched customer gets a push when their socket is not connected', async () => {
    const c = await m.customer();
    const r = await m.ranger({ at: CENTER });
    await m.api.patch(c, '/v1/me/push-token', { deviceId: c.deviceId, pushToken: 'cust-tok' });
    const before = m.api.push().outbox.length;

    await m.match(c, r);

    const sent = m.api.push().outbox.slice(before);
    const toCustomer = sent.find((s) => s.tokens.includes('cust-tok'));
    expect(toCustomer).toBeDefined();
    expect(toCustomer!.message.title).toMatch(/Ranger found/i);
  });

  it('status changes (en-route, arrived, confirmed) push the right party', async () => {
    const c = await m.customer();
    const r = await m.ranger({ at: CENTER });
    await m.api.patch(c, '/v1/me/push-token', { deviceId: c.deviceId, pushToken: 'cust-tok-2' });
    await m.api.patch(r, '/v1/me/push-token', { deviceId: r.deviceId, pushToken: 'ranger-tok-2' });
    const { jobId } = await m.match(c, r);
    await m.agree(c, r, jobId);
    const before = m.api.push().outbox.length;

    await m.confirmJob(c, r, jobId);

    const sent = m.api.push().outbox.slice(before);
    const toCustomer = sent.filter((s) => s.tokens.includes('cust-tok-2'));
    const toRanger = sent.filter((s) => s.tokens.includes('ranger-tok-2'));
    // The customer should have been told the Ranger was on the way and had arrived.
    expect(toCustomer.some((s) => /on the way/i.test(s.message.title))).toBe(true);
    expect(toCustomer.some((s) => /arrived/i.test(s.message.title))).toBe(true);
    // The Ranger should have been told the customer confirmed the job.
    expect(toRanger.some((s) => /confirmed/i.test(s.message.title))).toBe(true);
  });

  it('a Ranger with no registered push token causes no error (falls through cleanly)', async () => {
    const c = await m.customer();
    await m.ranger({ at: CENTER }); // deliberately: no push-token registered
    // The request would 500 (and this test would fail) if NotificationsService threw for a user
    // with zero registered devices instead of quietly doing nothing (see notifications.service.ts).
    const opened = await m.open(c);
    expect(opened.jobId).toBeTruthy();
  });
});
