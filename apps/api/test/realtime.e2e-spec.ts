import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { RealtimeService } from '../src/realtime/realtime.service';
import { type Harness, startHarness } from './harness';
import { type Customer, Market, northOf, type Ranger } from './market-helpers';
import type { Session } from './helpers';

let h: Harness;
let m: Market;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  h = await startHarness();
  await h.app.listen(0);
  url = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}`;
  m = new Market(h.app);
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await h?.stop();
});

/** Connect as a signed-in user and wait until the server has put the socket in the user's room. */
async function connect(s: Session, token = s.accessToken): Promise<Socket> {
  const socket = io(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  const realtime = h.app.get(RealtimeService);
  for (let i = 0; i < 50 && (await realtime.socketCount(s.userId)) === 0; i++)
    await new Promise((r) => setTimeout(r, 20));
  return socket;
}
const next = <T = unknown>(socket: Socket, event: string, ms = 3000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
const emitAck = <T = { ok: boolean; [k: string]: unknown }>(
  socket: Socket,
  event: string,
  body: unknown,
) => new Promise<T>((resolve) => socket.emit(event, body, (ack: T) => resolve(ack)));
const quiet = (socket: Socket, event: string, ms = 400) =>
  new Promise<boolean>((resolve) => {
    let got = false;
    socket.once(event, () => (got = true));
    setTimeout(() => resolve(!got), ms);
  });

let areaCounter = 0;
const newArea = () => ({ lat: 10.5 + ++areaCounter * 0.35, lng: 78.2 });

describe('socket authentication', () => {
  it('rejects a connection without a valid token, and disconnects it', async () => {
    const s = await m.api.signIn();
    for (const token of [undefined, 'garbage', s.accessToken.slice(0, -3) + 'abc']) {
      const socket = io(url, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      // Listen for both BEFORE either can fire: the server disconnects right after telling us.
      const told = next<{ code: string }>(socket, 'error.auth');
      const closed = new Promise((r) => socket.once('disconnect', r));
      expect((await told).code).toBe('UNAUTHENTICATED');
      await closed;
      expect(socket.connected).toBe(false);
    }
  });

  it('a suspended account cannot connect', async () => {
    const s = await m.api.signIn();
    await m.prisma.user.update({ where: { id: s.userId }, data: { status: 'SUSPENDED' } });
    const socket = io(url, {
      auth: { token: s.accessToken },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await next(socket, 'error.auth');
  });

  it('an unauthenticated socket cannot stay connected long enough to send anything', async () => {
    const socket = io(url, { auth: {}, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((r) => socket.once('disconnect', r));
    const ack = await Promise.race([
      emitAck(socket, 'location.update', { latitude: 13, longitude: 80 }),
      new Promise((r) => setTimeout(() => r('no-ack'), 300)),
    ]);
    expect(ack).toBe('no-ack'); // nobody is listening: the server dropped it
  });
});

describe('a request, live', () => {
  let area: { lat: number; lng: number };
  let c: Customer;
  let a: Ranger;
  let b: Ranger;
  let outsider: Ranger;
  let cs: Socket, as: Socket, bs: Socket, os: Socket;

  beforeAll(async () => {
    area = newArea();
    c = await m.customer({ at: area });
    a = await m.ranger({ at: northOf(200, area), name: 'Asha' });
    b = await m.ranger({ at: northOf(400, area), name: 'Bala' });
    outsider = await m.ranger({ at: northOf(30_000, area), name: 'Faraway' }); // never in range
    [cs, as, bs, os] = await Promise.all([connect(c), connect(a), connect(b), connect(outsider)]);
  });

  it('pushes the broadcast to nearby Rangers only, with no street address', async () => {
    const gotA = next<{ jobId: string; requestId: string; city: string; distanceM: number }>(
      as,
      'request.broadcast',
    );
    const gotB = next(bs, 'request.broadcast');
    const outsiderQuiet = quiet(os, 'request.broadcast', 800);
    const { requestId } = await m.open(c);
    const evA = await gotA;
    await gotB;
    expect(evA).toMatchObject({ requestId, city: 'Chennai' });
    expect(evA.distanceM).toBeLessThan(300);
    expect(JSON.stringify(evA)).not.toContain('Gandhi');
    expect(await outsiderQuiet).toBe(true);
    // (state for later tests)
    (globalThis as Record<string, unknown>).__req = {
      requestId,
      jobId: (await m.prisma.job.findFirstOrThrow({ where: { requestId } })).id,
    };
  });

  it('the Ranger accepts over the socket: winner acked, loser told "taken", customer told "matched"', async () => {
    const { requestId, jobId } = (globalThis as Record<string, unknown>).__req as {
      requestId: string;
      jobId: string;
    };
    const takenB = next<{ requestId: string; reason: string }>(bs, 'request.taken');
    const matchedC = next<{ jobId: string; workerId: string }>(cs, 'request.matched');
    const jobUpdatedC = next<{ status: string }>(cs, 'job.updated');

    const [ackA, ackB] = await Promise.all([
      emitAck(as, 'request.accept', { requestId }),
      emitAck(bs, 'request.accept', { requestId }),
    ]);
    const winnerIsA = ackA.ok === true;
    expect([ackA.ok, ackB.ok].sort()).toEqual([false, true]);
    const loserAck = (winnerIsA ? ackB : ackA) as { ok: false; code: string };
    expect(loserAck.code).toBe('REQUEST_TAKEN');

    const winner = winnerIsA ? a : b;
    expect((await matchedC).workerId).toBe(winner.userId);
    expect((await jobUpdatedC).status).toBe('MATCHED');
    if (!winnerIsA) await takenB.catch(() => undefined); // b won: nobody to tell, fine
    (globalThis as Record<string, unknown>).__winner = {
      winner,
      winnerSocket: winnerIsA ? as : bs,
      jobId,
    };
  });

  it('the loser receives request.taken (verified with a fresh request)', async () => {
    const area2 = newArea();
    const c2 = await m.customer({ at: area2 });
    const r1 = await m.ranger({ at: northOf(100, area2) });
    const r2 = await m.ranger({ at: northOf(200, area2) });
    const [s1, s2] = await Promise.all([connect(r1), connect(r2)]);
    const bc1 = next(s1, 'request.broadcast');
    const bc2 = next(s2, 'request.broadcast');
    const { requestId } = await m.open(c2);
    await Promise.all([bc1, bc2]);
    const t1 = next<{ reason: string }>(s1, 'request.taken', 1500).catch(() => null);
    const t2 = next<{ reason: string }>(s2, 'request.taken', 1500).catch(() => null);
    const ack = await emitAck(s1, 'request.accept', { requestId });
    expect(ack.ok).toBe(true);
    expect(await t1).toBeNull(); // the winner is not told "taken"
    expect(await t2).toEqual(expect.objectContaining({ reason: 'TAKEN' }));
  });

  it('live location: the Ranger sends over the socket, the customer receives it', async () => {
    const { winner, winnerSocket, jobId } = (globalThis as Record<string, unknown>).__winner as {
      winner: Ranger;
      winnerSocket: Socket;
      jobId: string;
    };
    await m.agree(c, winner, jobId);
    await m.api.post(winner, `/v1/jobs/${jobId}/en-route`).expect(200);
    const seen = next<{ jobId: string; latitude: number; longitude: number }>(
      cs,
      'location.update',
    );
    const ack = await emitAck<{ ok: boolean; data?: { recorded: boolean } }>(
      winnerSocket,
      'location.update',
      { latitude: northOf(900, area).lat, longitude: area.lng, accuracyM: 6 },
    );
    expect(ack.ok).toBe(true);
    const ev = await seen;
    expect(ev.jobId).toBe(jobId);
    expect(ev.latitude).toBeCloseTo(northOf(900, area).lat, 4);
    // Bad payloads are rejected with an ack, not a crash.
    const bad = await emitAck<{ ok: boolean }>(winnerSocket, 'location.update', {
      latitude: 'north',
      longitude: 80,
    });
    expect(bad.ok).toBe(false);
    // A customer cannot pretend to be a Ranger.
    const notRanger = await emitAck<{ ok: boolean }>(cs, 'location.update', {
      latitude: 13,
      longitude: 80,
    });
    expect(notRanger.ok).toBe(false);
  });

  it('chat: messages travel both ways in real time and are saved', async () => {
    const { winner, winnerSocket, jobId } = (globalThis as Record<string, unknown>).__winner as {
      winner: Ranger;
      winnerSocket: Socket;
      jobId: string;
    };
    const thread = (await m.api.get(c, `/v1/jobs/${jobId}/thread`)).body;
    const atRanger = next<{ body: string; senderId: string }>(winnerSocket, 'chat.message');
    const ack1 = await emitAck<{ ok: boolean; data: { id: string } }>(cs, 'chat.message', {
      threadId: thread.id,
      clientMsgId: 'ws-message-001',
      body: 'Gate code is 1234',
    });
    expect(ack1.ok).toBe(true);
    expect(await atRanger).toMatchObject({ body: 'Gate code is 1234', senderId: c.userId });

    const atCustomer = next<{ body: string }>(cs, 'chat.message');
    await emitAck(winnerSocket, 'chat.message', {
      threadId: thread.id,
      clientMsgId: 'ws-message-002',
      body: 'Thanks, 5 minutes away',
    });
    expect((await atCustomer).body).toBe('Thanks, 5 minutes away');
    expect(await m.prisma.chatMessage.count({ where: { threadId: thread.id } })).toBe(2);

    // Resending the same id (a retry after a flaky connection) is acknowledged but not delivered twice.
    const dup = await emitAck<{ ok: boolean; data: { id: string } }>(cs, 'chat.message', {
      threadId: thread.id,
      clientMsgId: 'ws-message-001',
      body: 'Gate code is 1234',
    });
    expect(dup.data.id).toBe(ack1.data.id);
    expect(await m.prisma.chatMessage.count({ where: { threadId: thread.id } })).toBe(2);

    // A stranger's socket cannot post into the thread.
    const stranger = await m.customer();
    const ss = await connect(stranger);
    const denied = await emitAck<{ ok: boolean; code: string }>(ss, 'chat.message', {
      threadId: thread.id,
      clientMsgId: 'ws-message-999',
      body: 'hello',
    });
    expect(denied).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    void winner;
  });
});

describe('cancel and reconnect', () => {
  it('a cancelled request tells the invited Rangers to drop it', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(200, area) });
    const rs = await connect(r);
    const bc = next(rs, 'request.broadcast');
    const { requestId } = await m.open(c);
    await bc;
    const taken = next<{ reason: string; requestId: string }>(rs, 'request.taken');
    await m.api.post(c, `/v1/requests/${requestId}/cancel`).expect(200);
    expect(await taken).toMatchObject({ reason: 'CANCELLED', requestId });
  });

  it('a Ranger who was offline while a request arrived still finds it after reconnecting (REST safety net)', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(200, area) });
    const { requestId } = await m.open(c); // r has no socket at all
    const list = (await m.incoming(r)).body;
    expect(list.map((x: { requestId: string }) => x.requestId)).toEqual([requestId]);
    const rs = await connect(r); // reconnects...
    const ack = await emitAck(rs, 'request.accept', { requestId }); // ...and can still accept
    expect(ack.ok).toBe(true);
  });

  it('the timeout event reaches the customer', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const cs = await connect(c);
    const { jobId } = await m.open(c);
    const timedOut = next<{ jobId: string }>(cs, 'request.timeout', 4000);
    const t = Date.now();
    for (const s of [61, 122, 183]) await m.scheduler.tick(new Date(t + s * 1000));
    expect((await timedOut).jobId).toBe(jobId);
  });
});
