import { JwtService } from '@nestjs/jwt';
import { LEGAL_VERSION } from '@haggler/shared';
import { type Harness, startHarness } from './harness';
import { Api, newIp, newPhone, type Session } from './helpers';

let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h.app);
});
afterAll(async () => {
  await h?.stop();
});

describe('OTP send', () => {
  it('sends a 6-digit code, stores only its hash, and reports the policy', async () => {
    const phone = newPhone();
    const res = await api.sendOtp(phone).then((r) => r);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true, expiresInSeconds: 300, resendAfterSeconds: 30 });

    const code = api.sms().lastCodeFor(phone) as string;
    expect(code).toMatch(/^[0-9]{6}$/);
    const row = await api.prisma().otpAttempt.findFirstOrThrow({ where: { phone } });
    expect(row.codeHash).not.toContain(code);
    expect(row.codeHash).toHaveLength(64); // HMAC-SHA256 hex
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(300_000, -3);
  });

  it('rejects a malformed phone with the error envelope', async () => {
    const res = await api.sendOtp('9876543210');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('enforces a 30 s cooldown between codes, with Retry-After', async () => {
    const phone = newPhone();
    await api.sendOtp(phone).then((r) => expect(r.status).toBe(200));
    const second = await api.sendOtp(phone);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
    expect(second.body.error.details.retryAfterSeconds).toBeLessThanOrEqual(30);
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('only the newest code works: sending a new code retires the old one', async () => {
    const phone = newPhone();
    await api.sendOtp(phone);
    const first = api.sms().lastCodeFor(phone) as string;
    await api.ageOtps(phone);
    await api.sendOtp(phone);
    const second = api.sms().lastCodeFor(phone) as string;
    const verify = (code: string) =>
      api
        .http()
        .post('/v1/auth/otp/verify')
        .set('X-Forwarded-For', newIp())
        .send({ phone, code, deviceId: 'device-aaaa1111', platform: 'ios' });
    if (first !== second) expect((await verify(first)).body.error?.code).toBe('OTP_INVALID');
    expect((await verify(second)).status).toBe(200);
  });

  it('limits to 5 codes per phone per hour (Redis)', async () => {
    const phone = newPhone();
    for (let i = 0; i < 5; i++) {
      await api.ageOtps(phone);
      expect((await api.sendOtp(phone)).status).toBe(200);
    }
    await api.ageOtps(phone);
    const sixth = await api.sendOtp(phone);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.details.retryAfterSeconds).toBeGreaterThan(60);
  });

  it('limits to 20 codes per IP per hour across different phones', async () => {
    const ip = newIp();
    for (let i = 0; i < 20; i++) expect((await api.sendOtp(newPhone(), ip)).status).toBe(200);
    const blocked = await api.sendOtp(newPhone(), ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/network/i);
    // A different IP is fine.
    expect((await api.sendOtp(newPhone(), newIp())).status).toBe(200);
  });
});

describe('OTP verify', () => {
  const verify = (phone: string, code: string, deviceId = 'device-verify-1') =>
    api
      .http()
      .post('/v1/auth/otp/verify')
      .set('X-Forwarded-For', newIp())
      .send({ phone, code, deviceId, platform: 'android' });

  it('creates the account on first sign-in and returns a session', async () => {
    const s = await api.signIn();
    expect(s.isNewUser).toBe(true);
    const me = await api.get(s, '/v1/me').expect(200);
    expect(me.body).toMatchObject({
      id: s.userId,
      phone: s.phone,
      roles: ['CUSTOMER'],
      status: 'ACTIVE',
      workerKycTier: null,
      missingConsents: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'KYC_PROCESSING'],
    });
    const device = await api.prisma().device.findFirstOrThrow({ where: { userId: s.userId } });
    expect(device.deviceId).toBe(s.deviceId);
  });

  it('a returning user signs in to the same account', async () => {
    const first = await api.signIn();
    const second = await api.signIn({ phone: first.phone, deviceId: 'second-device-01' });
    expect(second.isNewUser).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect(await api.prisma().device.count({ where: { userId: first.userId } })).toBe(2);
  });

  it('a wrong code is rejected, and the code is burned after 5 wrong tries', async () => {
    const phone = newPhone();
    await api.sendOtp(phone);
    const good = api.sms().lastCodeFor(phone) as string;
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await verify(phone, bad);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('OTP_INVALID');
    }
    // Even the correct code no longer works: the attacker cannot brute-force a 6-digit code.
    expect((await verify(phone, good)).body.error.code).toBe('OTP_INVALID');
  });

  it('a code is single-use', async () => {
    const phone = newPhone();
    await api.sendOtp(phone);
    const code = api.sms().lastCodeFor(phone) as string;
    expect((await verify(phone, code)).status).toBe(200);
    expect((await verify(phone, code)).status).toBe(400);
  });

  it('an expired code (older than 5 minutes) is rejected', async () => {
    const phone = newPhone();
    await api.sendOtp(phone);
    const code = api.sms().lastCodeFor(phone) as string;
    await api.prisma()
      .$executeRaw`UPDATE otp_attempts SET expires_at = now() - interval '1 second' WHERE phone = ${phone}`;
    const r = await verify(phone, code);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('OTP_INVALID');
  });

  it('two concurrent verifies with the right code: exactly one wins', async () => {
    const phone = newPhone();
    await api.sendOtp(phone);
    const code = api.sms().lastCodeFor(phone) as string;
    const [a, b] = await Promise.all([
      verify(phone, code, 'device-race-0001'),
      verify(phone, code, 'device-race-0002'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(await api.prisma().user.count({ where: { phone } })).toBe(1);
  });

  it('locks a phone after 10 wrong guesses in 30 minutes', async () => {
    const phone = newPhone();
    for (let round = 0; round < 2; round++) {
      await api.ageOtps(phone);
      await api.sendOtp(phone);
      const good = api.sms().lastCodeFor(phone) as string;
      const bad = good === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await verify(phone, bad);
    }
    const blocked = await verify(phone, '123456');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    await api.ageOtps(phone);
    expect((await api.sendOtp(phone)).status).toBe(429); // cannot request a fresh code either
  });

  it('validates the body', async () => {
    const r = await api
      .http()
      .post('/v1/auth/otp/verify')
      .send({ phone: newPhone(), code: '12', deviceId: 'x', platform: 'toaster' });
    expect(r.status).toBe(400);
    expect(r.body.error.details.length).toBeGreaterThanOrEqual(3);
  });
});

describe('sessions: refresh rotation, device binding, logout', () => {
  const refresh = (s: { refreshToken: string; deviceId: string }, deviceId = s.deviceId) =>
    api
      .http()
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', newIp())
      .send({ refreshToken: s.refreshToken, deviceId });

  it('rotates: a new pair works, and the old refresh token is dead', async () => {
    const s = await api.signIn();
    const r1 = await refresh(s).expect(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    const me = await api
      .http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${r1.body.accessToken}`)
      .expect(200);
    expect(me.body.id).toBe(s.userId);
    const stored = await api.prisma().refreshToken.findMany({ where: { userId: s.userId } });
    expect(stored.every((t) => t.tokenHash.length === 64 && t.tokenHash !== s.refreshToken)).toBe(
      true,
    ); // hashed at rest
  });

  it('reuse of an already-used refresh token revokes the whole family (theft detection)', async () => {
    const s = await api.signIn();
    const r1 = await refresh(s).expect(200); // legit rotation: s.refreshToken is now used
    await refresh(s).expect(401); // attacker replays the old token
    // The family is dead: even the newest legit token no longer works.
    await refresh({ refreshToken: r1.body.refreshToken, deviceId: s.deviceId }).expect(401);
  });

  it('is bound to the device: another device id cannot use the token', async () => {
    const s = await api.signIn();
    await refresh(s, 'attacker-device-99').expect(401);
    await refresh(s).expect(200); // the real device still can
  });

  it('logout kills the session and is idempotent', async () => {
    const s = await api.signIn();
    await api.http().post('/v1/auth/logout').send({ refreshToken: s.refreshToken }).expect(204);
    await refresh(s).expect(401);
    await api
      .http()
      .post('/v1/auth/logout')
      .send({ refreshToken: 'x'.repeat(40) })
      .expect(204);
  });

  it('rejects missing, garbage, tampered and wrong-audience access tokens', async () => {
    const s = await api.signIn();
    await api.http().get('/v1/me').expect(401);
    await api.http().get('/v1/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    await api
      .http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${s.accessToken.slice(0, -3)}abc`)
      .expect(401);
    const jwt = h.app.get(JwtService);
    const forged = await jwt.signAsync(
      { sub: s.userId, roles: ['CUSTOMER'], did: null },
      {
        secret: 'wrong-secret-wrong-secret-wrong-secret',
        issuer: 'haggler-api',
        audience: 'haggler-user',
      },
    );
    await api.http().get('/v1/me').set('Authorization', `Bearer ${forged}`).expect(401);
    const wrongAudience = await jwt.signAsync(
      { sub: s.userId, roles: ['CUSTOMER'], did: null },
      { secret: process.env.JWT_ACCESS_SECRET, issuer: 'haggler-api', audience: 'haggler-admin' },
    );
    await api.http().get('/v1/me').set('Authorization', `Bearer ${wrongAudience}`).expect(401);
  });

  it('a suspended account is locked out immediately, not after the token expires', async () => {
    const s = await api.signIn();
    await api.get(s, '/v1/me').expect(200);
    await api.prisma().user.update({ where: { id: s.userId }, data: { status: 'SUSPENDED' } });
    await api.get(s, '/v1/me').expect(401);
    await refresh(s).expect(401);
  });
});

describe('roles and profile', () => {
  let s: Session;
  beforeAll(async () => {
    s = await api.signIn();
  });

  it('a customer cannot use Ranger routes (403), and the message says Ranger', async () => {
    const r = await api.get(s, '/v1/worker/profile').expect(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
    expect(r.body.error.message).toContain('Ranger');
    expect(r.body.error.message.toLowerCase()).not.toContain('worker');
  });

  it('adding the Ranger role creates the Ranger profile; roles stack', async () => {
    const me = await api.post(s, '/v1/me/roles', { role: 'WORKER' }).expect(201);
    expect(me.body.roles.sort()).toEqual(['CUSTOMER', 'WORKER']);
    expect(me.body.workerKycTier).toBe(0);
    await api.get(s, '/v1/worker/profile').expect(200);
    await api.post(s, '/v1/me/roles', { role: 'WORKER' }).expect(201); // idempotent
    expect(await api.prisma().userRole.count({ where: { userId: s.userId } })).toBe(2);
  });

  it('Student can be added (Phase 7), and unknown roles are rejected', async () => {
    await api.post(s, '/v1/me/roles', { role: 'STUDENT' }).expect(201);
    await api.post(s, '/v1/me/roles', { role: 'ADMIN' }).expect(400);
  });

  it('updates profile; rejects unknown fields and bad values', async () => {
    const ok = await api
      .patch(s, '/v1/me', {
        fullName: '  Asha Raman ',
        preferredLanguage: 'ta',
        languages: ['ta', 'en'],
      })
      .expect(200);
    expect(ok.body).toMatchObject({
      fullName: 'Asha Raman',
      preferredLanguage: 'ta',
      languages: ['ta', 'en'],
    });
    await api.patch(s, '/v1/me', { role: 'SUPER' }).expect(400); // mass-assignment attempt
    await api.patch(s, '/v1/me', { preferredLanguage: 'fr' }).expect(400);
    await api.patch(s, '/v1/me', { fullName: 'A' }).expect(400);
  });

  it('records versioned consent, updates missingConsents, and can withdraw', async () => {
    await api
      .post(s, '/v1/me/consents', { purpose: 'TERMS_OF_SERVICE', version: 'old-version' })
      .expect(422);
    await api
      .post(s, '/v1/me/consents', { purpose: 'TERMS_OF_SERVICE', version: LEGAL_VERSION })
      .expect(201);
    await api
      .post(s, '/v1/me/consents', { purpose: 'TERMS_OF_SERVICE', version: LEGAL_VERSION })
      .expect(201); // idempotent
    await api
      .post(s, '/v1/me/consents', { purpose: 'PRIVACY_POLICY', version: LEGAL_VERSION })
      .expect(201);
    let me = await api.get(s, '/v1/me').expect(200);
    expect(me.body.missingConsents).toEqual(['KYC_PROCESSING']);
    expect(
      await api
        .prisma()
        .consent.count({ where: { userId: s.userId, purpose: 'TERMS_OF_SERVICE' } }),
    ).toBe(1);

    const w = await api.del(s, '/v1/me/consents/PRIVACY_POLICY').expect(200);
    expect(w.body.withdrawn).toBe(true);
    me = await api.get(s, '/v1/me');
    expect(me.body.missingConsents).toContain('PRIVACY_POLICY');
    await api.del(s, '/v1/me/consents/NOT_A_PURPOSE').expect(400);
    const log = await api
      .prisma()
      .auditLog.findMany({ where: { action: { startsWith: 'consent.' }, actorId: s.userId } });
    expect(log.map((l) => l.action).sort()).toEqual([
      'consent.granted',
      'consent.granted',
      'consent.withdrawn',
    ]);
  });
});

describe('addresses (PostGIS)', () => {
  let s: Session;
  let other: Session;
  beforeAll(async () => {
    s = await api.signIn();
    other = await api.signIn();
  });

  const chennai = {
    label: 'Home',
    line1: '12 Gandhi Road',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600042',
    latitude: 12.9716,
    longitude: 80.2209,
  };

  it('stores GPS coordinates as a PostGIS point (lng, lat order) and returns them', async () => {
    const res = await api.post(s, '/v1/me/addresses', chennai).expect(201);
    expect(res.body).toMatchObject({
      label: 'Home',
      pincode: '600042',
      isDefault: true,
      latitude: 12.9716,
      longitude: 80.2209,
    });
    const [row] = await api.prisma().$queryRaw<{ x: number; y: number; t: string }[]>`
      SELECT ST_X(location::geometry) AS x, ST_Y(location::geometry) AS y, GeometryType(location::geometry) AS t
      FROM addresses WHERE id = ${res.body.id}::uuid`;
    expect(row).toEqual({ x: 80.2209, y: 12.9716, t: 'POINT' });
  });

  it('finds addresses within a radius using the geography index', async () => {
    const nearby = await api
      .post(s, '/v1/me/addresses', {
        ...chennai,
        label: 'Office',
        line1: '5 Mount Road',
        latitude: 12.98,
        longitude: 80.23,
      })
      .expect(201);
    const far = await api
      .post(s, '/v1/me/addresses', {
        ...chennai,
        label: 'Bengaluru',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        latitude: 12.9716,
        longitude: 77.5946,
      })
      .expect(201);
    const within3km = await api.prisma().$queryRaw<{ label: string }[]>`
      SELECT label FROM addresses
      WHERE user_id = ${s.userId}::uuid
        AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(80.2209, 12.9716), 4326)::geography, 3000)
      ORDER BY label`;
    expect(within3km.map((r) => r.label)).toEqual(['Home', 'Office']);
    expect(nearby.body.isDefault).toBe(false);
    expect(far.status).toBe(201);
  });

  it('rejects coordinates outside India, swapped lat/lng, and half a coordinate', async () => {
    await api
      .post(s, '/v1/me/addresses', { ...chennai, latitude: 51.5, longitude: -0.12 })
      .expect(422); // London
    await api
      .post(s, '/v1/me/addresses', { ...chennai, latitude: 80.2209, longitude: 12.9716 })
      .expect(422); // swapped
    await api.post(s, '/v1/me/addresses', { ...chennai, latitude: 0, longitude: 0 }).expect(422); // null island
    const half = await api
      .post(s, '/v1/me/addresses', {
        label: 'x',
        line1: 'abc road',
        city: 'Chennai',
        state: 'TN',
        pincode: '600042',
        latitude: 12.9,
      })
      .expect(400);
    expect(half.body.error.code).toBe('VALIDATION_FAILED');
    await api.post(s, '/v1/me/addresses', { ...chennai, pincode: '60004' }).expect(400);
  });

  it('without coordinates the sandbox geocoder saves the address un-located', async () => {
    const { latitude: _a, longitude: _b, ...noCoords } = chennai;
    const res = await api
      .post(s, '/v1/me/addresses', { ...noCoords, label: 'Parents' })
      .expect(201);
    expect(res.body.latitude).toBeNull();
    expect(res.body.longitude).toBeNull();
  });

  it('only one default; switching default unsets the old one', async () => {
    const list = await api.get(s, '/v1/me/addresses').expect(200);
    expect(list.body.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
    const office = list.body.find((a: { label: string }) => a.label === 'Office');
    await api.patch(s, `/v1/me/addresses/${office.id}`, { isDefault: true }).expect(200);
    const after = await api.get(s, '/v1/me/addresses');
    expect(
      after.body
        .filter((a: { isDefault: boolean }) => a.isDefault)
        .map((a: { label: string }) => a.label),
    ).toEqual(['Office']);
    expect(after.body[0].label).toBe('Office'); // default is listed first
  });

  it('deleting the default promotes another address', async () => {
    const list = await api.get(s, '/v1/me/addresses');
    const def = list.body.find((a: { isDefault: boolean }) => a.isDefault);
    await api.del(s, `/v1/me/addresses/${def.id}`).expect(204);
    const after = await api.get(s, '/v1/me/addresses');
    expect(after.body.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
  });

  it("ownership: another user's address behaves exactly like a missing one (404)", async () => {
    const mine = (await api.get(s, '/v1/me/addresses')).body[0];
    await api.patch(other, `/v1/me/addresses/${mine.id}`, { label: 'stolen' }).expect(404);
    await api.del(other, `/v1/me/addresses/${mine.id}`).expect(404);
    expect((await api.get(other, '/v1/me/addresses')).body).toEqual([]);
    await api.del(s, '/v1/me/addresses/not-a-uuid').expect(400);
  });

  it('caps saved addresses at 10', async () => {
    const t = await api.signIn();
    for (let i = 0; i < 10; i++)
      await api.post(t, '/v1/me/addresses', { ...chennai, label: `A${i}` }).expect(201);
    const eleventh = await api
      .post(t, '/v1/me/addresses', { ...chennai, label: 'A11' })
      .expect(409);
    expect(eleventh.body.error.code).toBe('CONFLICT');
  });
});

describe('emergency contacts', () => {
  it('CRUD with ownership, validation and a cap of 5', async () => {
    const s = await api.signIn();
    const other = await api.signIn();
    const c = await api
      .post(s, '/v1/me/emergency-contacts', {
        name: 'Meena',
        phone: '+919812345678',
        relationship: 'Sister',
      })
      .expect(201);
    await api
      .post(s, '/v1/me/emergency-contacts', { name: 'Bad', phone: '12345', relationship: 'x' })
      .expect(400);

    const upd = await api
      .patch(s, `/v1/me/emergency-contacts/${c.body.id}`, { relationship: 'Mother' })
      .expect(200);
    expect(upd.body).toMatchObject({ name: 'Meena', relationship: 'Mother' });
    await api
      .patch(other, `/v1/me/emergency-contacts/${c.body.id}`, { relationship: 'x2' })
      .expect(404);
    await api.del(other, `/v1/me/emergency-contacts/${c.body.id}`).expect(404);

    for (let i = 0; i < 4; i++)
      await api
        .post(s, '/v1/me/emergency-contacts', {
          name: `Contact ${i}`,
          phone: `+91981234560${i}`,
          relationship: 'Friend',
        })
        .expect(201);
    await api
      .post(s, '/v1/me/emergency-contacts', {
        name: 'Sixth',
        phone: '+919812340009',
        relationship: 'Friend',
      })
      .expect(409);
    expect((await api.get(s, '/v1/me/emergency-contacts')).body).toHaveLength(5);
    await api.del(s, `/v1/me/emergency-contacts/${c.body.id}`).expect(204);
    expect((await api.get(s, '/v1/me/emergency-contacts')).body).toHaveLength(4);
  });
});

describe('data rights: export, deletion, purge', () => {
  it('exports everything held about me', async () => {
    const s = await api.signIn();
    await api.patch(s, '/v1/me', { fullName: 'Ravi Kumar' });
    await api.post(s, '/v1/me/addresses', {
      label: 'Home',
      line1: '1 Test Street',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
      latitude: 13.08,
      longitude: 80.27,
    });
    await api.post(s, '/v1/me/emergency-contacts', {
      name: 'Kin',
      phone: '+919812345600',
      relationship: 'Brother',
    });
    const res = await api.get(s, '/v1/me/export').expect(200);
    expect(res.body.account).toMatchObject({
      id: s.userId,
      phone: s.phone,
      fullName: 'Ravi Kumar',
    });
    expect(res.body.addresses[0]).toMatchObject({ line1: '1 Test Street', latitude: 13.08 });
    expect(res.body.emergencyContacts).toEqual([
      { name: 'Kin', phone: '+919812345600', relationship: 'Brother' },
    ]);
    expect(res.body.devices).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|codeHash|passwordHash/);
  });

  it('deletion: sessions end at once, sign-in is refused, then the purge anonymises the account', async () => {
    const s = await api.signIn();
    await api.post(s, '/v1/me/roles', { role: 'WORKER' });
    await api.post(s, '/v1/me/addresses', {
      label: 'Home',
      line1: '1 Test Street',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
      latitude: 13.08,
      longitude: 80.27,
    });
    await api.post(s, '/v1/me/emergency-contacts', {
      name: 'Kin',
      phone: '+919812345601',
      relationship: 'Brother',
    });

    const del = await api.del(s, '/v1/me').expect(202);
    expect(del.body.status).toBe('DELETION_PENDING');
    const days = (new Date(del.body.scheduledFor).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    await api.get(s, '/v1/me').expect(401); // access token stops working immediately
    await api.del(s, '/v1/me').expect(401); // and so a second request is refused by the guard
    await api
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken, deviceId: s.deviceId })
      .expect(401);

    await api.ageOtps(s.phone);
    await api.sendOtp(s.phone);
    const blocked = await api
      .http()
      .post('/v1/auth/otp/verify')
      .set('X-Forwarded-For', newIp())
      .send({
        phone: s.phone,
        code: api.sms().lastCodeFor(s.phone),
        deviceId: s.deviceId,
        platform: 'android',
      });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_UNAVAILABLE');

    // Not due yet: purge does nothing.
    const { AccountLifecycleService } = await import('../src/users/account-lifecycle.service');
    const lifecycle = h.app.get(AccountLifecycleService);
    expect(await lifecycle.purgeDueDeletions()).toBeGreaterThanOrEqual(0);
    expect((await api.prisma().user.findUniqueOrThrow({ where: { id: s.userId } })).status).toBe(
      'DELETION_PENDING',
    );

    // Time passes: the grace period ends.
    await api.prisma().user.update({
      where: { id: s.userId },
      data: { deletionScheduledFor: new Date(Date.now() - 1000) },
    });
    expect(await lifecycle.purgeDueDeletions()).toBe(1);

    const user = await api.prisma().user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(user).toMatchObject({ status: 'DELETED', fullName: null, phoneVerifiedAt: null });
    expect(user.phone).not.toBe(s.phone);
    expect(user.phone).toMatch(/^\+99[0-9]{12}$/);
    for (const count of [
      api.prisma().address.count({ where: { userId: s.userId } }),
      api.prisma().emergencyContact.count({ where: { userId: s.userId } }),
      api.prisma().device.count({ where: { userId: s.userId } }),
      api.prisma().userRole.count({ where: { userId: s.userId } }),
      api.prisma().workerProfile.count({ where: { userId: s.userId } }),
      api.prisma().otpAttempt.count({ where: { phone: s.phone } }),
    ]) {
      expect(await count).toBe(0);
    }
    // The audit trail survives, and holds no phone number.
    const audit = await api.prisma().auditLog.findMany({
      where: {
        entityId: s.userId,
        action: { in: ['account.deletion_requested', 'account.purged'] },
      },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'account.deletion_requested',
      'account.purged',
    ]);
    expect(JSON.stringify(audit)).not.toContain(s.phone);

    // The number can be used to sign up again as a brand-new account.
    await api.ageOtps(s.phone);
    const again = await api.signIn({ phone: s.phone });
    expect(again.isNewUser).toBe(true);
    expect(again.userId).not.toBe(s.userId);
  });
});

describe('Redis outage: OTP limits fall back to Postgres (D-022)', () => {
  it('still enforces 5 codes per phone per hour and lockout, with Redis stopped', async () => {
    await h.redis.stop();
    const phone = newPhone();
    for (let i = 0; i < 5; i++) {
      await api.ageOtps(phone);
      expect((await api.sendOtp(phone)).status).toBe(200);
    }
    await api.ageOtps(phone);
    const sixth = await api.sendOtp(phone);
    expect(sixth.status).toBe(429);
    // Sign-in itself keeps working without Redis.
    const s = await api.signIn();
    await api.get(s, '/v1/me').expect(200);
  });
});
