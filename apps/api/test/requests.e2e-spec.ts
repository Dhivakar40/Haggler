import { type Harness, startHarness } from './harness';
import { CENTER, type Customer, Market, northOf, type Ranger } from './market-helpers';

let h: Harness;
let m: Market;

beforeAll(async () => {
  h = await startHarness();
  m = new Market(h.app);
});
afterAll(async () => {
  await h?.stop();
});

/** Each test uses its own area so Rangers from other tests are never eligible. */
let areaCounter = 0;
const newArea = () => ({ lat: 12.5 + ++areaCounter * 0.4, lng: 79.0 });

describe('creating a request', () => {
  let c: Customer;
  beforeAll(async () => {
    c = await m.customer();
  });

  it('snapshots the price band, address and location, and starts in BROADCASTING', async () => {
    const res = await m.request(c).expect(201);
    expect(res.body).toMatchObject({
      status: 'BROADCASTING',
      viewerRole: 'CUSTOMER',
      categorySlug: 'electrician',
      urgency: 'IMMEDIATE',
      city: 'Chennai',
      pincode: '600042',
      worker: null,
      band: { scope: 'DEFAULT', minPaise: 19900, medianPaise: 34900, maxPaise: 69900 },
      location: { latitude: CENTER.lat, longitude: CENTER.lng },
    });
    expect(res.body.addressLine).toContain('12 Gandhi Road');
    expect(res.body.broadcast).toMatchObject({ wave: 1, slaEstimateMinutes: 4 }); // no history yet: the default
    expect(res.body.broadcast.deadline).toBeTruthy();
    const events = await m.prisma.jobEvent.findMany({
      where: { jobId: res.body.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => `${e.fromStatus}>${e.toStatus}`)).toEqual([
      'null>REQUESTED',
      'REQUESTED>BROADCASTING',
    ]);
    await m.api.post(c, `/v1/requests/${res.body.requestId}/cancel`).expect(200);
  });

  it('rejects bad input with helpful errors', async () => {
    await m.request(c, { categorySlug: 'astronaut' }).expect(404);
    await m.request(c, { description: 'fan' }).expect(400); // too short
    await m.request(c, { addressId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await m.request(c, { urgency: 'SCHEDULED' }).expect(400); // scheduledFor missing
    await m
      .request(c, {
        urgency: 'SCHEDULED',
        scheduledFor: new Date(Date.now() + 10 * 60_000).toISOString(),
      })
      .expect(422);
    await m
      .request(c, {
        urgency: 'SCHEDULED',
        scheduledFor: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      })
      .expect(422);
    await m.request(c, { genderPreference: 'ROBOT' }).expect(400);
  });

  it('an address without a location cannot be used (the Ranger needs somewhere to go)', async () => {
    const noLoc = await m.customer({ located: false });
    const res = await m.request(noLoc).expect(422);
    expect(res.body.error.details.code).toBe('ADDRESS_NEEDS_LOCATION');
  });

  it("nobody can request using someone else's address", async () => {
    const other = await m.customer();
    await m.api
      .post(other, '/v1/requests', {
        categorySlug: 'electrician',
        description: 'Please help with my fan',
        addressId: c.addressId,
        urgency: 'IMMEDIATE',
      })
      .expect(404);
  });

  it('limits open requests per customer (3)', async () => {
    const x = await m.customer();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await m.open(x)).requestId);
    const fourth = await m.request(x).expect(409);
    expect(fourth.body.error.details.code).toBe('TOO_MANY_OPEN');
    await m.api.post(x, `/v1/requests/${ids[0]}/cancel`).expect(200);
    await m.request(x).expect(201); // a slot is free again
  });

  it('a scheduled request waits: it is not broadcast until its lead time', async () => {
    const x = await m.customer();
    const when = new Date(Date.now() + 5 * 3_600_000);
    const res = await m
      .request(x, { urgency: 'SCHEDULED', scheduledFor: when.toISOString() })
      .expect(201);
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.scheduledFor).toBe(when.toISOString());
    await m.scheduler.tick(new Date()); // not due
    expect((await m.api.get(x, `/v1/requests/${res.body.requestId}`)).body.status).toBe(
      'REQUESTED',
    );
    await m.scheduler.tick(new Date(when.getTime() - 30 * 60_000)); // 30 min before: inside the 60 min lead
    expect((await m.api.get(x, `/v1/requests/${res.body.requestId}`)).body.status).toBe(
      'BROADCASTING',
    );
  });
});

describe('photos and voice note', () => {
  it('attaches uploaded media; the Ranger sees only counts until they win the job', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(500, area) });
    const photo1 = await m.uploadMedia(c, 'PHOTO');
    const photo2 = await m.uploadMedia(c, 'PHOTO');
    const voice = await m.uploadMedia(c, 'VOICE', 4096, 42);
    const { requestId, jobId } = await m.open(c, { mediaIds: [photo1, photo2, voice] });

    const inc = (await m.incoming(r)).body;
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({
      photoCount: 2,
      hasVoiceNote: true,
      city: 'Chennai',
      pincode: '600042',
    });
    expect(JSON.stringify(inc[0])).not.toContain('Gandhi'); // no street address before matching

    await m.api.post(r, `/v1/requests/${requestId}/accept`).expect(200);
    const after = (await m.api.get(r, `/v1/jobs/${jobId}`)).body;
    expect(after.media.map((x: { kind: string }) => x.kind).sort()).toEqual([
      'PHOTO',
      'PHOTO',
      'VOICE',
    ]);
    const bytes = await fetch(after.media[0].url);
    expect(bytes.status).toBe(200);
    expect(after.addressLine).toContain('Gandhi');
  });

  it('enforces the limits: 5 photos, 1 voice note, 60 s, allowed types, ownership', async () => {
    const c = await m.customer({ at: newArea() });
    const photos = [];
    for (let i = 0; i < 6; i++) photos.push(await m.uploadMedia(c, 'PHOTO', 500));
    const many = await m.request(c, { mediaIds: photos }).expect(422);
    expect(many.body.error.message).toMatch(/at most 5 photos/);
    const v1 = await m.uploadMedia(c, 'VOICE', 500, 10);
    const v2 = await m.uploadMedia(c, 'VOICE', 500, 10);
    await m.request(c, { mediaIds: [v1, v2] }).expect(422);

    await m.api
      .post(c, '/v1/requests/media', {
        kind: 'VOICE',
        contentType: 'audio/mp4',
        sizeBytes: 500,
        durationSeconds: 61,
      })
      .expect(400);
    await m.api
      .post(c, '/v1/requests/media', { kind: 'VOICE', contentType: 'audio/mp4', sizeBytes: 500 })
      .expect(400);
    await m.api
      .post(c, '/v1/requests/media', {
        kind: 'VOICE',
        contentType: 'audio/mp4',
        sizeBytes: 4 * 1024 * 1024,
        durationSeconds: 30,
      })
      .expect(422);
    await m.api
      .post(c, '/v1/requests/media', {
        kind: 'PHOTO',
        contentType: 'application/pdf',
        sizeBytes: 500,
      })
      .expect(422);

    const other = await m.customer();
    const foreign = await m.uploadMedia(other, 'PHOTO', 500);
    await m.request(c, { mediaIds: [foreign] }).expect(404);
    const used = photos[0] as string;
    await m.request(c, { mediaIds: [used] }).expect(201); // first use is fine...
    await m.request(c, { mediaIds: [used] }).expect(422); // ...attaching the same file again is not
  });

  it('media that was never uploaded cannot be attached', async () => {
    const c = await m.customer({ at: newArea() });
    const p = await m.api
      .post(c, '/v1/requests/media', { kind: 'PHOTO', contentType: 'image/jpeg', sizeBytes: 800 })
      .expect(200);
    await m.api.post(c, `/v1/requests/media/${p.body.mediaId}/confirm`).expect(409);
    await m.request(c, { mediaIds: [p.body.mediaId] }).expect(422);
  });
});

describe('who gets invited (eligibility)', () => {
  it('only online, verified (tier 2), category-matched, free, unblocked, fresh, nearby Rangers', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const good = await m.ranger({ at: northOf(300, area), name: 'Good' });
    const offline = await m.ranger({ at: northOf(300, area), online: false });
    const tier1 = await m.ranger({ at: northOf(300, area), tier: 1, online: false });
    const wrongCategory = await m.ranger({ at: northOf(300, area), categories: ['plumber'] });
    const busy = await m.ranger({ at: northOf(300, area), name: 'Busy' });
    const blocked = await m.ranger({ at: northOf(300, area), name: 'Blocked' });
    const stale = await m.ranger({ at: northOf(300, area), name: 'Stale' });
    const far = await m.ranger({ at: northOf(2600, area), name: 'Far' }); // outside the 2 km first wave

    await m.prisma.block.create({ data: { blockerId: c.userId, blockedId: blocked.userId } }); // customer blocked this Ranger
    await m.prisma
      .$executeRaw`UPDATE worker_profiles SET last_location_at = now() - interval '10 minutes' WHERE user_id = ${stale.userId}::uuid`;
    // `busy` already has an active job with another customer
    const other = await m.customer({ at: area });
    await m.match(other, busy);

    const { jobId } = await m.open(c);
    const invited = await m.prisma.requestBroadcast.findMany({ where: { jobId } });
    expect(invited.map((i) => i.workerId)).toEqual([good.userId]);
    for (const r of [offline, tier1, wrongCategory, busy, blocked, stale, far])
      expect(invited.some((i) => i.workerId === r.userId)).toBe(false);
  });

  it('a block in EITHER direction prevents matching', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(200, area) });
    await m.prisma.block.create({ data: { blockerId: r.userId, blockedId: c.userId } }); // the Ranger blocked the customer
    const { jobId } = await m.open(c);
    expect(await m.prisma.requestBroadcast.count({ where: { jobId } })).toBe(0);
  });

  it('a Ranger is never invited to their own request', async () => {
    const area = newArea();
    const r = await m.ranger({ at: area });
    await m.api.post(r, '/v1/me/addresses', {
      label: 'Home',
      line1: '5 Test Street',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
      latitude: area.lat,
      longitude: area.lng,
    });
    const addressId = (await m.api.get(r, '/v1/me/addresses')).body[0].id;
    const { jobId } = await m.open({ ...r, addressId });
    expect(await m.prisma.requestBroadcast.count({ where: { jobId } })).toBe(0);
  });

  it('going online needs tier 2 and a category; going offline removes you from matching', async () => {
    const area = newArea();
    const noCats = await m.api.signIn();
    await m.api.post(noCats, '/v1/me/roles', { role: 'WORKER' });
    await m.api
      .post(noCats, '/v1/worker/online', { latitude: area.lat, longitude: area.lng })
      .expect(403); // tier 0
    await m.prisma.workerProfile.update({ where: { userId: noCats.userId }, data: { kycTier: 2 } });
    const res = await m.api
      .post(noCats, '/v1/worker/online', { latitude: area.lat, longitude: area.lng })
      .expect(422);
    expect(res.body.error.message).toMatch(/Choose the work/);
    await m.api.post(noCats, '/v1/worker/online', { latitude: 51.5, longitude: -0.12 }).expect(422); // outside India

    const r = await m.ranger({ at: area });
    expect((await m.api.get(r, '/v1/worker/presence')).body.isOnline).toBe(true);
    await m.api.post(r, '/v1/worker/offline').expect(200);
    expect((await m.api.get(r, '/v1/worker/presence')).body.isOnline).toBe(false);
    const c = await m.customer({ at: area });
    const { jobId } = await m.open(c);
    expect(await m.prisma.requestBroadcast.count({ where: { jobId } })).toBe(0);
  });

  it('a customer cannot use Ranger endpoints', async () => {
    const c = await m.customer();
    await m.api.post(c, '/v1/worker/online', { latitude: 13, longitude: 80 }).expect(403);
    await m.api.get(c, '/v1/worker/incoming').expect(403);
  });

  it('D-078 Part G: an "Other" request reaches Rangers regardless of their registered category', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const plumber = await m.ranger({ at: northOf(300, area), categories: ['plumber'] });
    const electrician = await m.ranger({ at: northOf(300, area), categories: ['electrician'] });
    const { jobId } = await m.open(c, {
      categorySlug: 'other',
      description: 'Need help moving a wardrobe up two flights of stairs this weekend',
    });
    const invited = await m.prisma.requestBroadcast.findMany({ where: { jobId } });
    expect(invited.map((i) => i.workerId).sort()).toEqual(
      [plumber.userId, electrician.userId].sort(),
    );
  });

  it('a normal-category request still excludes a Ranger with no matching WorkerCategory', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const plumber = await m.ranger({ at: northOf(300, area), categories: ['plumber'] });
    const { jobId } = await m.open(c, { categorySlug: 'electrician' });
    const invited = await m.prisma.requestBroadcast.findMany({ where: { jobId } });
    expect(invited.some((i) => i.workerId === plumber.userId)).toBe(false);
  });
});

describe('waves: nearest first, then widen, then time out', () => {
  it('sends wave 1 to the top 5 within 2 km, then 5 km, then 10 km, then times out', async () => {
    const area = newArea();
    await m.prisma.systemConfig.upsert({
      where: { key: 'broadcast_wave_interval_seconds' },
      update: { value: 60 },
      create: { key: 'broadcast_wave_interval_seconds', value: 60 },
    });
    m.config.refresh();
    const c = await m.customer({ at: area });
    const rangers: Ranger[] = [];
    for (let i = 0; i < 7; i++) rangers.push(await m.ranger({ at: northOf(200 + i * 100, area) })); // 7 within 2 km
    const mid = await m.ranger({ at: northOf(3500, area) }); // wave 2 (5 km)
    const far = await m.ranger({ at: northOf(8000, area) }); // wave 3 (10 km)
    const tooFar = await m.ranger({ at: northOf(12_000, area) }); // never

    const { jobId, requestId } = await m.open(c);
    const inWave = async (w: number) =>
      (await m.prisma.requestBroadcast.findMany({ where: { jobId, wave: w } })).map(
        (b) => b.workerId,
      );

    const w1 = await inWave(1);
    expect(w1).toHaveLength(5); // wave size is 5 even though 7 were eligible
    expect(w1).not.toContain(mid.userId);
    // The closest five were chosen (closer scores higher; other factors equal for new Rangers).
    expect(new Set(w1)).toEqual(new Set(rangers.slice(0, 5).map((r) => r.userId)));

    const t = Date.now();
    await m.scheduler.tick(new Date(t + 30_000)); // not due yet
    expect(await inWave(2)).toHaveLength(0);

    await m.scheduler.tick(new Date(t + 61_000));
    const w2 = await inWave(2);
    // Wave 2 covers 5 km: the 2 remaining near Rangers and the 3.5 km one (nobody is invited twice).
    expect(new Set(w2)).toEqual(new Set([rangers[5]!.userId, rangers[6]!.userId, mid.userId]));

    await m.scheduler.tick(new Date(t + 122_000));
    expect(await inWave(3)).toEqual([far.userId]);
    expect(
      (await m.prisma.requestBroadcast.findMany({ where: { jobId } })).some(
        (b) => b.workerId === tooFar.userId,
      ),
    ).toBe(false);

    // Timeout: after the last wave's interval, the broadcast is exhausted and everyone is told.
    await m.scheduler.tick(new Date(t + 183_000));
    const view = (await m.api.get(c, `/v1/requests/${requestId}`)).body;
    expect(view.status).toBe('BROADCASTING'); // still open: the customer decides
    expect(view.broadcast.wave).toBe(3);
    expect((await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).nextWaveAt).toBeNull();
    expect(await m.prisma.requestBroadcast.count({ where: { jobId, response: 'PENDING' } })).toBe(
      0,
    ); // all closed
    expect((await m.incoming(far)).body).toEqual([]); // and gone from Rangers' lists
    await m.api.post(far, `/v1/requests/${requestId}/accept`).expect(409);
  });

  it('re-broadcast after a timeout starts again from wave 1 and re-invites the same Rangers', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { jobId, requestId } = await m.open(c);
    await m.api.post(c, `/v1/requests/${requestId}/rebroadcast`).expect(409); // not timed out yet

    await m.api.post(r, `/v1/requests/${requestId}/decline`).expect(200);
    const t = Date.now();
    for (const s of [61, 122, 183]) await m.scheduler.tick(new Date(t + s * 1000));
    expect((await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).nextWaveAt).toBeNull();

    const res = await m.api.post(c, `/v1/requests/${requestId}/rebroadcast`).expect(200);
    expect(res.body.status).toBe('BROADCASTING');
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.broadcastAttempt).toBe(2);
    const invites = await m.prisma.requestBroadcast.findMany({
      where: { jobId, workerId: r.userId },
      orderBy: { attempt: 'asc' },
    });
    expect(invites.map((i) => `${i.attempt}:${i.response}`)).toEqual(['1:DECLINED', '2:PENDING']);
    expect((await m.incoming(r)).body).toHaveLength(1);
    await m.api.post(r, `/v1/requests/${requestId}/accept`).expect(200);
  });

  it('a timed-out request nobody re-broadcasts is closed after 2 hours', async () => {
    const c = await m.customer({ at: newArea() });
    const { jobId } = await m.open(c);
    const t = Date.now();
    for (const s of [61, 122, 183]) await m.scheduler.tick(new Date(t + s * 1000));
    await m.scheduler.tick(new Date(t + 3 * 3_600_000));
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: 'CANCELLED', cancelReason: 'NO_RANGER_FOUND' });
    const events = await m.prisma.jobEvent.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.at(-1)?.toStatus).toBe('CANCELLED');
  });

  it('cancelling closes the invitations and tells the Rangers', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: northOf(300, area) });
    const { requestId, jobId } = await m.open(c);
    expect((await m.incoming(r)).body).toHaveLength(1);
    await m.api.post(c, `/v1/requests/${requestId}/cancel`).expect(200);
    expect((await m.incoming(r)).body).toEqual([]);
    expect((await m.prisma.requestBroadcast.findFirstOrThrow({ where: { jobId } })).response).toBe(
      'EXPIRED',
    );
    await m.api.post(r, `/v1/requests/${requestId}/accept`).expect(409);
    await m.api.post(c, `/v1/requests/${requestId}/cancel`).expect(409); // already cancelled: cannot cancel again
  });
});

describe('ranking and gender preference', () => {
  it('a preferred-gender Ranger is favoured, and the customer is told when none is available', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    await m.prisma.systemConfig.upsert({
      where: { key: 'broadcast_wave_size' },
      update: { value: 1 },
      create: { key: 'broadcast_wave_size', value: 1 },
    });
    m.config.refresh();
    const male = await m.ranger({ at: northOf(200, area), gender: 'MALE' }); // closer
    const female = await m.ranger({ at: northOf(600, area), gender: 'FEMALE' });
    const withPref = await m.open(c, { genderPreference: 'FEMALE' });
    expect(
      (await m.prisma.requestBroadcast.findMany({ where: { jobId: withPref.jobId } })).map(
        (b) => b.workerId,
      ),
    ).toEqual([female.userId]);
    expect(withPref.dto.genderPreferenceMet).toBe(true);

    const c2 = await m.customer({ at: area });
    const noPref = await m.open(c2);
    expect(
      (await m.prisma.requestBroadcast.findMany({ where: { jobId: noPref.jobId } })).map(
        (b) => b.workerId,
      ),
    ).toEqual([male.userId]); // pure distance
    expect(noPref.dto.genderPreferenceMet).toBeNull();

    // Nobody of the preferred gender nearby: the request still matches, and says so.
    const area2 = newArea();
    const c3 = await m.customer({ at: area2 });
    await m.ranger({ at: northOf(200, area2), gender: 'MALE' });
    const unmet = await m.open(c3, { genderPreference: 'FEMALE' });
    expect(unmet.dto.genderPreferenceMet).toBe(false);
    expect(await m.prisma.requestBroadcast.count({ where: { jobId: unmet.jobId } })).toBe(1); // soft: never blocks matching
    await m.prisma.systemConfig.update({
      where: { key: 'broadcast_wave_size' },
      data: { value: 5 },
    });
    m.config.refresh();
  });

  it('the SLA estimate comes from real local history once there is enough', async () => {
    const area = newArea();
    const c = await m.customer({ at: area });
    // Seed 5 matched jobs in this PIN cluster taking ~ 6 minutes each.
    for (let i = 0; i < 5; i++) {
      const req = await m.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO service_requests (customer_id, category_id, description, address_line, city, state, pincode, location, urgency, band_scope, band_min_paise, band_median_paise, band_max_paise, updated_at)
        SELECT ${c.userId}::uuid, id, 'history job for SLA', 'x', 'Chennai', 'TN', '600042', ST_SetSRID(ST_MakePoint(80.27, 13.08), 4326)::geography, 'IMMEDIATE', 'DEFAULT', 100, 200, 300, now()
        FROM service_categories WHERE slug = 'electrician' RETURNING id::text`;
      await m.prisma
        .$executeRaw`INSERT INTO jobs (request_id, customer_id, status, created_at, matched_at, updated_at) VALUES (${req[0]!.id}::uuid, ${c.userId}::uuid, 'CANCELLED', now() - interval '1 day', now() - interval '1 day' + interval '6 minutes', now())`;
    }
    const res = await m.request(c).expect(201);
    expect(res.body.broadcast.slaEstimateMinutes).toBe(6);
  });
});
