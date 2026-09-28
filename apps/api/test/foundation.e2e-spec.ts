import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { type Harness, runSeed, startHarness } from './harness';

let h: Harness;
let app: INestApplication;
let prisma: PrismaService;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  h = await startHarness();
  app = h.app;
  prisma = app.get(PrismaService);
});
afterAll(async () => {
  await h?.stop();
});

describe('health', () => {
  it('liveness is ok and echoes a request id', async () => {
    const res = await http().get('/health/live').set('x-request-id', 'trace-123').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('readiness reports postgres+redis up and the adapter modes', async () => {
    const res = await http().get('/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toEqual({ postgres: 'up', redis: 'up' });
    expect(res.body.adapters).toEqual({
      sms: 'sandbox',
      kyc: 'manual_admin',
      payments: 'sandbox',
      calls: 'disabled',
      push: 'sandbox',
      maps: 'sandbox',
    });
  });

  it('exposes prometheus metrics', async () => {
    await http().get('/v1/categories').expect(200);
    const res = await http().get('/metrics').expect(200);
    expect(res.text).toContain('http_request_duration_seconds_bucket');
    expect(res.text).toContain('route="/v1/categories"');
  });
});

describe('catalog (real DB, seeded)', () => {
  it('lists the 9 seeded categories, in order, with no "worker" wording', async () => {
    const res = await http().get('/v1/categories').expect(200);
    expect(res.body).toHaveLength(9);
    expect(res.body[0]).toMatchObject({ slug: 'electrician', nameKey: 'categories.electrician' });
    const gas = res.body.find((c: { slug: string }) => c.slug === 'gas_appliance_repair');
    expect(gas.requiresLicense).toBe(true);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('worker');
  });

  it('price band falls back to the seeded default when there is no local data', async () => {
    const res = await http()
      .get('/v1/price-bands?category=electrician&pincode=600042&city=Chennai')
      .expect(200);
    expect(res.body).toMatchObject({
      scope: 'DEFAULT',
      minPaise: 19900,
      medianPaise: 34900,
      maxPaise: 69900,
      sampleSize: 0,
      isSeededDefault: true,
    });
  });

  it('prefers city then pincode-cluster bands once they have enough samples', async () => {
    const cat = await prisma.serviceCategory.findUniqueOrThrow({ where: { slug: 'electrician' } });
    await prisma.priceBand.create({
      data: {
        categoryId: cat.id,
        scope: 'CITY',
        city: 'Chennai',
        minPaise: 25000,
        medianPaise: 40000,
        maxPaise: 70000,
        sampleSize: 31,
      },
    });
    const c1 = await http()
      .get('/v1/price-bands?category=electrician&pincode=600042&city=chennai')
      .expect(200);
    expect(c1.body).toMatchObject({ scope: 'CITY', medianPaise: 40000, isSeededDefault: false });

    await prisma.priceBand.create({
      data: {
        categoryId: cat.id,
        scope: 'PINCODE_CLUSTER',
        pincodePrefix: '600',
        minPaise: 30000,
        medianPaise: 45000,
        maxPaise: 80000,
        sampleSize: 4,
      },
    });
    // n=4 < min sample 10, so the thin cluster is ignored.
    const c2 = await http()
      .get('/v1/price-bands?category=electrician&pincode=600042&city=Chennai')
      .expect(200);
    expect(c2.body.scope).toBe('CITY');

    await prisma.priceBand.updateMany({
      where: { scope: 'PINCODE_CLUSTER' },
      data: { sampleSize: 12 },
    });
    const c3 = await http()
      .get('/v1/price-bands?category=electrician&pincode=600042&city=Chennai')
      .expect(200);
    expect(c3.body).toMatchObject({ scope: 'PINCODE_CLUSTER', medianPaise: 45000 });
  });

  it('rejects bad input with the error envelope', async () => {
    const bad = await http().get('/v1/price-bands?category=electrician&pincode=abc').expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.details[0]).toContain('pincode');
    expect(bad.body.error.requestId).toBeDefined();

    const missing = await http().get('/v1/price-bands').expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_FAILED');

    const unknown = await http().get('/v1/price-bands?category=astronaut').expect(404);
    expect(unknown.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('unknown routes also use the envelope', async () => {
    const res = await http().get('/v1/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('database guarantees', () => {
  it('rejects a price band whose min exceeds its median', async () => {
    const cat = await prisma.serviceCategory.findUniqueOrThrow({ where: { slug: 'plumber' } });
    await expect(
      prisma.priceBand.create({
        data: {
          categoryId: cat.id,
          scope: 'CITY',
          city: 'Pune',
          minPaise: 50000,
          medianPaise: 40000,
          maxPaise: 60000,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a second DEFAULT band for the same category (NULL-safe unique index)', async () => {
    const cat = await prisma.serviceCategory.findUniqueOrThrow({ where: { slug: 'plumber' } });
    await expect(
      prisma.priceBand.create({
        data: { categoryId: cat.id, scope: 'DEFAULT', minPaise: 1, medianPaise: 2, maxPaise: 3 },
      }),
    ).rejects.toThrow();
  });

  it('rejects a malformed phone number', async () => {
    await expect(prisma.user.create({ data: { phone: '98765' } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { phone: '+919876543210' } })).resolves.toBeDefined();
  });

  it('audit_logs is append-only: UPDATE and DELETE are rejected', async () => {
    const row = await prisma.auditLog.create({
      data: { actorType: 'SYSTEM', action: 'test.created', entityType: 'test', entityId: '1' },
    });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe(
      'test.created',
    );
  });

  it('PostGIS: ST_DWithin finds nearby addresses via the GIST index', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: '+919876543210' } });
    // Chennai Central (80.2707E, 13.0827N) and ~1.4 km away; Bengaluru is ~290 km away.
    const insert = (label: string, lng: number, lat: number) =>
      prisma.$executeRaw`
        INSERT INTO addresses (user_id, label, line1, city, state, pincode, location, updated_at)
        VALUES (${user.id}::uuid, ${label}, 'x', 'c', 's', '600001',
                ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, now())`;
    await insert('centre', 80.2707, 13.0827);
    await insert('near', 80.2785, 13.09);
    await insert('far', 77.5946, 12.9716);

    const near = await prisma.$queryRaw<{ label: string }[]>`
      SELECT label FROM addresses
      WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(80.2707, 13.0827), 4326)::geography, 2000)
      ORDER BY label`;
    expect(near.map((r) => r.label)).toEqual(['centre', 'near']);

    // With so few rows the planner would seq-scan; force the choice to prove the index is usable.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT 1 FROM addresses WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(80.27, 13.08), 4326)::geography, 2000)`,
      );
    });
    expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toContain('addresses_location_gist');
  });

  it('seed is idempotent', async () => {
    const before = await prisma.serviceCategory.count();
    const bandsBefore = await prisma.priceBand.count({ where: { scope: 'DEFAULT' } });
    runSeed(h.databaseUrl);
    expect(await prisma.serviceCategory.count()).toBe(before);
    expect(await prisma.priceBand.count({ where: { scope: 'DEFAULT' } })).toBe(bandsBefore);
  });

  it('seed does not overwrite an admin-edited system_config value', async () => {
    await prisma.systemConfig.update({ where: { key: 'commission_bps' }, data: { value: 800 } });
    runSeed(h.databaseUrl);
    expect(
      (await prisma.systemConfig.findUniqueOrThrow({ where: { key: 'commission_bps' } })).value,
    ).toBe(800);
  });

  it('does not seed minimum wages (counsel must provide them)', async () => {
    expect(await prisma.minimumWageRule.count()).toBe(0);
  });
});

describe('rate limiting', () => {
  it('returns 429 with the RATE_LIMITED envelope once the per-IP limit is exceeded (Redis-backed)', async () => {
    const limited = await h.createApp({ THROTTLE_LIMIT: '20' });
    try {
      const hit = () =>
        request(limited.getHttpServer())
          .get('/v1/categories')
          .set('X-Forwarded-For', '203.0.113.9');
      for (let i = 0; i < 20; i++) await hit().expect(200);
      const res = await hit().expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      // A different client IP is unaffected.
      await request(limited.getHttpServer())
        .get('/v1/categories')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect(200);
    } finally {
      await limited.close();
    }
  });
});

describe('graceful degradation', () => {
  it('stays ready but reports degraded when Redis is down', async () => {
    await h.redis.stop();
    const res = await http().get('/health/ready').expect(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks).toEqual({ postgres: 'up', redis: 'down' });
    // Non-Redis endpoints keep working.
    await http().get('/v1/categories').expect(200);
  });
});
