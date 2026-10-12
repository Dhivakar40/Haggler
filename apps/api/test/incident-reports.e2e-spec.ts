import type { INestApplication } from '@nestjs/common';
import { Api } from './helpers';
import { type Harness, startHarness } from './harness';
import { CENTER, Market, northOf } from './market-helpers';

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

let areaCounter = 0;
const newArea = () => ({ lat: 24.0 + ++areaCounter * 0.4, lng: 77.5 });

describe('D-093 (Sub-phase J3): incident reports', () => {
  it('a THEFT report automatically holds the accused account pending review', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);

    const reported = await m.api
      .post(c, `/v1/jobs/${jobId}/incident-reports`, {
        reason: 'THEFT',
        description: 'The Ranger took a tool from the balcony that was not part of the job.',
      })
      .expect(200);
    expect(reported.body.status).toBe('OPEN');

    const worker = await m.prisma.user.findUniqueOrThrow({ where: { id: r.userId } });
    expect(worker.status).toBe('TEMPORARY_HOLD');
    expect(worker.holdStartedAt).not.toBeNull();

    // A held account cannot sign in / use its existing token for anything further.
    const blocked = await m.api.get(r, `/v1/jobs/${jobId}`);
    expect(blocked.status).toBe(401);
  });

  it('an OTHER-reason report does not hold anyone automatically', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);

    await m.api
      .post(c, `/v1/jobs/${jobId}/incident-reports`, {
        reason: 'OTHER',
        description: 'Something felt off about how the job went, not sure what to call it.',
      })
      .expect(200);

    const worker = await m.prisma.user.findUniqueOrThrow({ where: { id: r.userId } });
    expect(worker.status).toBe('ACTIVE');
  });

  it('admin CLEAR releases the hold; admin SUSPEND is permanent', async () => {
    const area1 = newArea();
    const c1 = await m.customer({ at: area1 });
    const r1 = await m.ranger({ at: northOf(300, area1) });
    const { jobId: job1 } = await m.match(c1, r1);
    const report1 = await m.api
      .post(c1, `/v1/jobs/${job1}/incident-reports`, {
        reason: 'HARASSMENT',
        description: 'Made comments that made me uncomfortable throughout the visit.',
      })
      .expect(200);

    const queue = await api.adminGet(agentToken, '/v1/admin/incident-reports');
    expect(queue.status).toBe(200);
    expect(queue.body.items.some((i: { id: string }) => i.id === report1.body.id)).toBe(true);

    const evidence = await api.adminGet(
      agentToken,
      `/v1/admin/incident-reports/${report1.body.id}/evidence`,
    );
    expect(evidence.status).toBe(200);
    expect(evidence.body.jobId).toBe(job1);

    const cleared = await api.adminPost(
      agentToken,
      `/v1/admin/incident-reports/${report1.body.id}/resolve`,
      { resolution: 'CLEAR', note: 'Reviewed the job log — nothing credible, releasing the hold.' },
    );
    expect(cleared.status).toBe(200);
    const w1 = await m.prisma.user.findUniqueOrThrow({ where: { id: r1.userId } });
    expect(w1.status).toBe('ACTIVE');
    expect(w1.holdStartedAt).toBeNull();

    const area2 = newArea();
    const c2 = await m.customer({ at: area2 });
    const r2 = await m.ranger({ at: northOf(300, area2) });
    const { jobId: job2 } = await m.match(c2, r2);
    const report2 = await m.api
      .post(c2, `/v1/jobs/${job2}/incident-reports`, {
        reason: 'THEFT',
        description: 'A tool went missing right after the Ranger left the premises.',
      })
      .expect(200);

    const suspended = await api.adminPost(
      agentToken,
      `/v1/admin/incident-reports/${report2.body.id}/resolve`,
      { resolution: 'SUSPEND', note: 'Confirmed against the job log and a prior complaint.' },
    );
    expect(suspended.status).toBe(200);
    const w2 = await m.prisma.user.findUniqueOrThrow({ where: { id: r2.userId } });
    expect(w2.status).toBe('SUSPENDED');
  });
});

describe('D-093: SOS also holds the other party pending review', () => {
  it('raising SOS holds the other party, not the one who raised it', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId } = await m.match(c, r);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    await m.ping(r, CENTER);

    await m.api.post(c, `/v1/jobs/${jobId}/sos`, { note: 'feeling unsafe' }).expect(200);

    const worker = await m.prisma.user.findUniqueOrThrow({ where: { id: r.userId } });
    expect(worker.status).toBe('TEMPORARY_HOLD');
    const customer = await m.prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    expect(customer.status).toBe('ACTIVE');
  });
});
