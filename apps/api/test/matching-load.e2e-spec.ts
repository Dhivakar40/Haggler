import { randomUUID } from 'node:crypto';
import { RedisService } from '../src/redis/redis.service';
import { MatchingService } from '../src/marketplace/matching.service';
import { RequestsService } from '../src/marketplace/requests.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { type Harness, startHarness } from './harness';
import { MarketplaceConfig } from '../src/marketplace/marketplace-config.service';

/**
 * LOAD TEST (Phase 2 requirement): 500 Rangers online, 100 customers requesting at the same
 * moment, and every invited Ranger tapping "Accept" for every request at the same moment.
 *
 * What must be true no matter how the accepts interleave:
 *   I1  a request is matched at most once (one Ranger), and job_matches agrees;
 *   I2  a Ranger holds at most one active job;
 *   I3  every successful accept was to an invited Ranger, and successes == matched jobs;
 *   I4  every failure is a clean, expected 409 (REQUEST_TAKEN / ALREADY_ON_JOB), never a 500;
 *   I5  no request that still had a free invited Ranger was left unmatched.
 * Run twice: with Redis (layer 1 + layer 2) and with Redis reported down (database alone).
 */
const RANGERS = 500;
const CUSTOMERS = 100;
const WAVE_SIZE = 25; // each request invites 25 Rangers, so every Ranger competes for ~5 requests
const AREA = { lat: 11.0, lng: 76.95 }; // Coimbatore: a private area for this test

let h: Harness;
let prisma: PrismaService;
let matching: MatchingService;
let requests: RequestsService;

beforeAll(async () => {
  h = await startHarness();
  prisma = h.app.get(PrismaService);
  matching = h.app.get(MatchingService);
  requests = h.app.get(RequestsService);
  await prisma.systemConfig.upsert({
    where: { key: 'broadcast_wave_size' },
    update: { value: WAVE_SIZE },
    create: { key: 'broadcast_wave_size', value: WAVE_SIZE },
  });
  h.app.get(MarketplaceConfig).refresh();
});
afterAll(async () => {
  await h?.stop();
});

/** Bulk-create verified Rangers around AREA, all online in the electrician category. */
async function seedRangers(n: number, tag: string): Promise<string[]> {
  const ids = Array.from({ length: n }, () => randomUUID());
  await prisma.user.createMany({
    data: ids.map((id, i) => ({
      id,
      phone: `+9199${tag}${String(i).padStart(6, '0')}`,
      phoneVerifiedAt: new Date(),
      fullName: `Ranger ${i}`,
    })),
  });
  await prisma.userRole.createMany({
    data: ids.flatMap((userId) => [
      { userId, role: 'CUSTOMER' as const },
      { userId, role: 'WORKER' as const },
    ]),
  });
  await prisma.workerProfile.createMany({
    data: ids.map((userId) => ({ userId, kycTier: 2, isOnline: true })),
  });
  const cat = await prisma.serviceCategory.findUniqueOrThrow({ where: { slug: 'electrician' } });
  const profiles = await prisma.workerProfile.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  await prisma.workerCategory.createMany({
    data: profiles.map((p) => ({ workerProfileId: p.id, categoryId: cat.id })),
  });
  // Scatter them within ~1.4 km of the centre (all inside the 2 km first wave).
  const lats = ids.map((_, i) => AREA.lat + ((i % 25) - 12) * 0.0005);
  const lngs = ids.map((_, i) => AREA.lng + ((Math.floor(i / 25) % 25) - 12) * 0.0005);
  await prisma.$executeRaw`
    UPDATE worker_profiles wp SET last_location = ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography, last_location_at = now()
    FROM (SELECT unnest(${ids}::uuid[]) AS id, unnest(${lngs}::float8[]) AS lng, unnest(${lats}::float8[]) AS lat) v
    WHERE wp.user_id = v.id`;
  return ids;
}

async function seedCustomers(n: number, tag: string): Promise<{ id: string; addressId: string }[]> {
  const ids = Array.from({ length: n }, () => randomUUID());
  await prisma.user.createMany({
    data: ids.map((id, i) => ({
      id,
      phone: `+9198${tag}${String(i).padStart(6, '0')}`,
      phoneVerifiedAt: new Date(),
      fullName: `Customer ${i}`,
    })),
  });
  await prisma.userRole.createMany({
    data: ids.map((userId) => ({ userId, role: 'CUSTOMER' as const })),
  });
  const addrIds = ids.map(() => randomUUID());
  await prisma.address.createMany({
    data: ids.map((userId, i) => ({
      id: addrIds[i]!,
      userId,
      label: 'Home',
      line1: `${i} Load Test Street`,
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      pincode: '641001',
      isDefault: true,
    })),
  });
  await prisma.$executeRaw`
    UPDATE addresses a SET location = ST_SetSRID(ST_MakePoint(${AREA.lng}, ${AREA.lat}), 4326)::geography WHERE a.id = ANY(${addrIds}::uuid[])`;
  return ids.map((id, i) => ({ id, addressId: addrIds[i]! }));
}

const shuffle = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
};
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;

async function runScenario(label: string, tag: string, redisDown: boolean) {
  const rangerIds = await seedRangers(RANGERS, tag);
  const customers = await seedCustomers(CUSTOMERS, tag);

  // 1) 100 customers request at once.
  const createStart = Date.now();
  const created = await Promise.all(
    customers.map((c) =>
      requests.create(c.id, {
        categorySlug: 'electrician',
        description: 'Load test: fan not working',
        addressId: c.addressId,
        urgency: 'IMMEDIATE',
        genderPreference: 'ANY',
        mediaIds: [],
      }),
    ),
  );
  const createMs = Date.now() - createStart;
  const jobs = await prisma.job.findMany({
    where: { customerId: { in: customers.map((c) => c.id) } },
    select: { id: true, requestId: true },
  });
  expect(jobs).toHaveLength(CUSTOMERS);
  expect(created).toHaveLength(CUSTOMERS);

  const invites = await prisma.requestBroadcast.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) } },
    select: { jobId: true, workerId: true },
  });
  const invitedByJob = new Map<string, Set<string>>();
  for (const i of invites)
    (invitedByJob.get(i.jobId) ?? invitedByJob.set(i.jobId, new Set()).get(i.jobId)!).add(
      i.workerId,
    );
  const requestOf = new Map(jobs.map((j) => [j.id, j.requestId]));
  expect(invites.length).toBeGreaterThanOrEqual(CUSTOMERS * WAVE_SIZE * 0.95);

  // 2) Every invited Ranger accepts every request they were invited to, all at once, in random order.
  const attempts = shuffle(invites.map((i) => ({ jobId: i.jobId, workerId: i.workerId })));
  const down = redisDown
    ? jest.spyOn(h.app.get(RedisService), 'ping').mockResolvedValue(false)
    : null;
  const outcomes: { jobId: string; workerId: string; ok: boolean; code?: string; ms: number }[] =
    [];
  const acceptStart = Date.now();
  try {
    await Promise.all(
      attempts.map(async (a) => {
        const t = Date.now();
        try {
          await matching.accept(a.workerId, requestOf.get(a.jobId) as string);
          outcomes.push({ ...a, ok: true, ms: Date.now() - t });
        } catch (e) {
          const r = (
            e as { getResponse?: () => { details?: { code?: string }; code?: string } }
          ).getResponse?.();
          outcomes.push({
            ...a,
            ok: false,
            code: r?.details?.code ?? r?.code ?? `UNEXPECTED:${String(e)}`,
            ms: Date.now() - t,
          });
        }
      }),
    );
  } finally {
    down?.mockRestore();
  }
  const acceptMs = Date.now() - acceptStart;

  // 3) Check the invariants against the database, not against our own bookkeeping.
  const successes = outcomes.filter((o) => o.ok);
  const matched = await prisma.job.findMany({
    where: { id: { in: jobs.map((j) => j.id) }, status: 'MATCHED' },
    select: { id: true, workerId: true },
  });
  const matches = await prisma.jobMatch.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) } },
  });

  // I1: one winner per request, and job_matches agrees with jobs.
  expect(new Set(matched.map((j) => j.id)).size).toBe(matched.length);
  expect(matches).toHaveLength(matched.length);
  for (const mt of matches)
    expect(matched.find((j) => j.id === mt.jobId)?.workerId).toBe(mt.workerId);
  const winsPerJob = new Map<string, number>();
  for (const s of successes) winsPerJob.set(s.jobId, (winsPerJob.get(s.jobId) ?? 0) + 1);
  for (const [, n] of winsPerJob) expect(n).toBe(1);

  // I2: no Ranger holds two active jobs.
  const perWorker = new Map<string, number>();
  for (const j of matched) perWorker.set(j.workerId!, (perWorker.get(j.workerId!) ?? 0) + 1);
  expect(Math.max(...perWorker.values())).toBe(1);
  const activeRows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM (SELECT worker_id FROM jobs WHERE worker_id = ANY(${rangerIds}::uuid[]) AND status IN ('MATCHED','NEGOTIATING','AGREED','EN_ROUTE','ARRIVED','IN_PROGRESS') GROUP BY worker_id HAVING count(*) > 1) x`;
  expect(Number(activeRows[0]?.n)).toBe(0);

  // I3: successes are exactly the matched jobs, and were invited.
  expect(successes).toHaveLength(matched.length);
  for (const s of successes) expect(invitedByJob.get(s.jobId)?.has(s.workerId)).toBe(true);

  // I4: every failure is an expected clean conflict.
  const codes = new Map<string, number>();
  for (const o of outcomes.filter((x) => !x.ok))
    codes.set(o.code as string, (codes.get(o.code as string) ?? 0) + 1);
  for (const code of codes.keys()) expect(['REQUEST_TAKEN', 'ALREADY_ON_JOB']).toContain(code);

  // I5: any unmatched request had every one of its invited Rangers busy elsewhere.
  const unmatched = jobs.filter((j) => !matched.some((m) => m.id === j.id));
  const busy = new Set(matched.map((j) => j.workerId!));
  for (const j of unmatched)
    for (const w of invitedByJob.get(j.id) ?? []) expect(busy.has(w)).toBe(true);

  const lat = outcomes.map((o) => o.ms);
  const summary = {
    scenario: label,
    rangersOnline: RANGERS,
    concurrentRequests: CUSTOMERS,
    invitations: invites.length,
    acceptAttempts: attempts.length,
    successfulMatches: successes.length,
    conflicts: Object.fromEntries(codes),
    doubleAccepts: 0,
    createRequestsMs: createMs,
    acceptAllMs: acceptMs,
    acceptLatencyMs: { p50: pct(lat, 0.5), p95: pct(lat, 0.95), max: Math.max(...lat) },
  };

  console.log(`LOAD RESULT ${JSON.stringify(summary)}`);
  return summary;
}

jest.setTimeout(240_000);

describe('matching engine under load', () => {
  it('500 Rangers x 100 concurrent requests, Redis lock + database: no double accepts', async () => {
    const s = await runScenario('redis+postgres', '01', false);
    expect(s.successfulMatches).toBeGreaterThan(50); // real contention, real winners
    expect(s.successfulMatches).toBeLessThanOrEqual(CUSTOMERS);
  });

  it('same load with Redis DOWN: the database alone still allows exactly one winner per request', async () => {
    const s = await runScenario('postgres-only', '02', true);
    expect(s.successfulMatches).toBeGreaterThan(50);
    expect(s.successfulMatches).toBeLessThanOrEqual(CUSTOMERS);
  });
});
