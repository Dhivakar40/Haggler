import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, type IncomingRequest, SOCKET_EVENTS } from '@haggler/shared';
import { CodedException, notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RealtimeService } from '../realtime/realtime.service';
import { JobTransitions } from './job-transitions.service';
import { MarketplaceConfig } from './marketplace-config.service';
import { PresenceService } from './presence.service';
import { rankCandidates } from './ranking';

export class RequestTakenException extends CodedException {
  constructor(message = 'This request was already taken by another Ranger.') {
    super(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, message, { code: 'REQUEST_TAKEN' });
  }
}

/**
 * Turns "electrician" into "Electrician" for a push notification's body text. The real i18n keys
 * (categories.electrician, etc.) live client-side (D-050: push copy isn't localised yet), so this
 * is a placeholder good enough for an English-language notification, not a translation.
 */
const categoryTitle = (slug: string): string =>
  slug.length ? slug[0]!.toUpperCase() + slug.slice(1).replace(/-/g, ' ') : slug;

/** Lua: delete the lock only if we still own it, so we never delete someone else's lock. */
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const LOCK_TTL_MS = 10_000;

/**
 * Runs tasks one at a time PER KEY (per request), in this process. When Redis is down every
 * would-be winner reaches Postgres at once; without this, hundreds of transactions for the SAME
 * request queue up and some time out. With it, the first one runs, and each later one re-checks the
 * status (a cheap read) and steps aside. Different requests still run in parallel. This is only an
 * optimisation: correctness never depends on it (the database constraints do).
 */
class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    this.tails.set(key, next);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }
  }
}

/**
 * Broadcast waves and first-accept-wins matching (D3).
 *
 * WAVES. A request is offered to the best few nearby Rangers first (wave 1: 2 km, top 5), then, if
 * nobody accepts within the interval, to the next best within 5 km, then 10 km. This is kinder
 * than blasting everyone (Rangers are not spammed, and the closest people get first chance).
 *
 * FIRST ACCEPT WINS, in two layers, so it is safe even if one layer fails:
 *   1. Redis  SET request:{job}:lock worker:{id} NX PX 10000  - a cheap, fast gate: only one
 *      caller gets "OK"; everyone else is told "taken" without touching Postgres.
 *   2. Postgres transaction:
 *        UPDATE jobs SET status='MATCHED', worker_id=W WHERE id=J AND status='BROADCASTING' AND worker_id IS NULL
 *        INSERT job_matches (job_id, worker_id)          -- UNIQUE(job_id)
 *      plus the partial unique index "one active job per Ranger". If Redis is down, or two API
 *      servers both think they hold the lock, the database still lets exactly one through.
 *
 * Trace (two Rangers, Asha and Ravi, tap Accept in the same millisecond):
 *   Asha  SET NX -> OK      Ravi  SET NX -> nil  => Ravi gets 409 REQUEST_TAKEN at once.
 *   (Redis down) both go to Postgres: Asha's UPDATE matches 1 row; Ravi's matches 0 rows => 409.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cfg: MarketplaceConfig,
    private readonly presence: PresenceService,
    private readonly transitions: JobTransitions,
    private readonly realtime: RealtimeService,
  ) {}

  // ---- waves ---------------------------------------------------------------------------------------

  /** Jobs whose next wave is due (or that were scheduled and are now within their lead time). */
  async processDue(now = new Date(), limit = 50): Promise<number> {
    const due = await this.prisma.job.findMany({
      where: { status: { in: ['REQUESTED', 'BROADCASTING'] }, nextWaveAt: { lte: now } },
      select: { id: true },
      orderBy: { nextWaveAt: 'asc' },
      take: limit,
    });
    let n = 0;
    for (const j of due) if (await this.advance(j.id, now)) n += 1;
    return n;
  }

  /**
   * Send the next wave for one job. Returns false if another worker/scheduler already claimed it.
   * The claim (`next_wave_at = NULL WHERE next_wave_at <= now`) is atomic, so two API instances
   * running their schedulers at once never send the same wave twice.
   */
  async advance(jobId: string, now = new Date()): Promise<boolean> {
    const claimed = await this.prisma.job.updateMany({
      where: { id: jobId, status: { in: ['REQUESTED', 'BROADCASTING'] }, nextWaveAt: { lte: now } },
      data: { nextWaveAt: null },
    });
    if (claimed.count !== 1) return false;

    const job = await this.prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { request: true },
    });
    const cfg = await this.cfg.get();
    const wave = job.currentWave;

    // Out of waves: the broadcast has timed out. The customer chooses: re-broadcast or cancel.
    if (wave >= cfg.broadcast_radii_m.length) {
      await this.timeOut(job.id, job.customerId, job.status);
      return true;
    }

    const point = await this.prisma.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM service_requests WHERE id = ${job.requestId}::uuid`;
    const p = point[0];
    if (!p) return true;
    // Rush (Phase 9, D-069: a paid Rush fee, or a free perk of an active Haggler Plus membership at
    // request time) skips straight to the widest configured radius in one wave, instead of
    // progressively expanding — see the currentWave jump below, which then sends any further
    // advance() call straight to timeOut() rather than a second wave.
    const lastWave = cfg.broadcast_radii_m.length - 1;
    const radiusM = cfg.broadcast_radii_m[job.isRush ? lastWave : wave] as number;
    const nextWave = job.isRush ? cfg.broadcast_radii_m.length : wave + 1;

    const raw = await this.presence.findCandidates({
      jobId: job.id,
      attempt: job.broadcastAttempt,
      customerId: job.customerId,
      categoryId: job.request.categoryId,
      longitude: p.lng,
      latitude: p.lat,
      radiusM,
    });
    const ranked = rankCandidates(raw, {
      radiusM,
      genderPreference: job.request.genderPreference,
    }).slice(0, cfg.broadcast_wave_size);

    if (ranked.length) {
      await this.prisma.requestBroadcast.createMany({
        data: ranked.map((r) => ({
          jobId: job.id,
          attempt: job.broadcastAttempt,
          wave: nextWave,
          workerId: r.userId,
          distanceM: r.distanceM,
          score: r.score,
        })),
        skipDuplicates: true,
      });
    }

    const interval = cfg.broadcast_wave_interval_seconds * 1000;
    await this.prisma.$transaction(async (tx) => {
      if (job.status === 'REQUESTED') {
        await this.transitions.move(tx, {
          jobId: job.id,
          from: 'REQUESTED',
          to: 'BROADCASTING',
          actor: 'SYSTEM',
        });
      }
      const invitedGenders = await tx.$queryRaw<{ gender: string | null }[]>`
        SELECT wp.gender::text AS gender FROM request_broadcasts rb JOIN worker_profiles wp ON wp.user_id = rb.worker_id
        WHERE rb.job_id = ${job.id}::uuid AND rb.attempt = ${job.broadcastAttempt}`;
      const pref = job.request.genderPreference;
      await tx.job.update({
        where: { id: job.id },
        data: {
          currentWave: nextWave,
          nextWaveAt: new Date(now.getTime() + interval),
          // The countdown the customer sees: the whole broadcast. Rush only ever sends one wave, so
          // its deadline is a single interval away instead of the full multi-wave span.
          broadcastDeadline:
            job.broadcastDeadline ??
            new Date(now.getTime() + interval * (job.isRush ? 1 : cfg.broadcast_radii_m.length)),
          genderPreferenceMet:
            pref === 'ANY' ? null : invitedGenders.some((g) => g.gender === pref),
        },
      });
    });

    for (const r of ranked) {
      const dto = await this.incomingDto(job.id, r.userId);
      if (dto)
        this.realtime.emitToUser(r.userId, SOCKET_EVENTS.broadcast, dto, {
          title: 'New job nearby',
          body: `${categoryTitle(dto.categorySlug)} · ${(dto.distanceM / 1000).toFixed(1)} km away`,
          data: { jobId: dto.jobId, type: 'broadcast' },
        });
    }
    await this.transitions.notify(job.id, { wave: nextWave });
    this.logger.log(
      `job ${job.id}: wave ${nextWave}${job.isRush ? ' (rush)' : ''} (${radiusM} m) invited ${ranked.length} of ${raw.length} eligible`,
    );
    return true;
  }

  private async timeOut(jobId: string, customerId: string, status: string) {
    await this.prisma.$transaction(async (tx) => {
      if (status === 'REQUESTED')
        await this.transitions.move(tx, {
          jobId,
          from: 'REQUESTED',
          to: 'BROADCASTING',
          actor: 'SYSTEM',
        });
      await tx.job.update({ where: { id: jobId }, data: { nextWaveAt: null } });
    });
    await this.closeBroadcasts(jobId, 'EXPIRED');
    this.realtime.emitToUser(
      customerId,
      SOCKET_EVENTS.timeout,
      { jobId },
      {
        title: 'No Ranger available',
        body: 'Nobody accepted your request in time. You can try again.',
        data: { jobId, type: 'timeout' },
      },
    );
    await this.transitions.notify(jobId, { timedOut: true });
  }

  /** Mark still-pending invitations as closed and tell those Rangers to drop the request. */
  async closeBroadcasts(jobId: string, reason: 'CANCELLED' | 'EXPIRED') {
    const pending = await this.prisma.requestBroadcast.findMany({
      where: { jobId, response: 'PENDING' },
      select: { id: true, workerId: true },
    });
    if (!pending.length) return;
    await this.prisma.requestBroadcast.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { response: 'EXPIRED', respondedAt: new Date() },
    });
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { requestId: true },
    });
    for (const p of pending)
      this.realtime.emitToUser(p.workerId, SOCKET_EVENTS.taken, {
        jobId,
        requestId: job?.requestId,
        reason,
      });
  }

  // ---- accept / decline -----------------------------------------------------------------------------

  async accept(workerId: string, requestId: string) {
    const job = await this.prisma.job.findUnique({ where: { requestId } });
    if (!job) throw notFound('Request not found');
    const inv = await this.prisma.requestBroadcast.findFirst({
      where: { jobId: job.id, workerId, attempt: job.broadcastAttempt },
    });
    if (!inv)
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
        'You were not invited to this request.',
      );
    if (job.status !== 'BROADCASTING' || job.workerId) throw new RequestTakenException();
    if (inv.response !== 'PENDING')
      throw new RequestTakenException('You already responded to this request.');

    // Layer 1: the Redis gate. Losing here is instant and free.
    const lockKey = `request:${job.id}:lock`;
    const lockVal = `worker:${workerId}`;
    let haveLock = false;
    try {
      if (await this.redis.ping()) {
        const ok = await this.redis.client.set(lockKey, lockVal, 'PX', LOCK_TTL_MS, 'NX');
        if (ok !== 'OK') throw new RequestTakenException();
        haveLock = true;
      }
    } catch (err) {
      if (err instanceof RequestTakenException) throw err;
      this.logger.warn('Redis unavailable: relying on the database alone for first-accept');
    }

    try {
      // Layer 2: the database decides. Exactly one UPDATE can flip BROADCASTING -> MATCHED.
      await this.mutex.run(job.id, async () => {
        const fresh = await this.prisma.job.findUnique({
          where: { id: job.id },
          select: { status: true, workerId: true },
        });
        if (!fresh || fresh.status !== 'BROADCASTING' || fresh.workerId)
          throw new RequestTakenException();
        await this.prisma.$transaction(
          async (tx) => {
            await this.transitions
              .move(tx, {
                jobId: job.id,
                from: 'BROADCASTING',
                to: 'MATCHED',
                actor: 'WORKER',
                actorUserId: workerId,
                data: { workerId, matchedAt: new Date(), nextWaveAt: null },
              })
              .catch((e) => {
                // Lost the race: someone else's UPDATE already changed the status.
                if (
                  e instanceof CodedException &&
                  (e.getResponse() as { details?: { code?: string } }).details?.code === 'STALE_JOB'
                )
                  throw new RequestTakenException();
                throw e;
              });
            await tx.jobMatch.create({ data: { jobId: job.id, workerId } }); // UNIQUE(job_id)
            await tx.chatThread.create({ data: { jobId: job.id } });
            await tx.requestBroadcast.updateMany({
              where: { jobId: job.id, workerId },
              data: { response: 'ACCEPTED', respondedAt: new Date() },
            });
            await tx.requestBroadcast.updateMany({
              where: { jobId: job.id, response: 'PENDING', NOT: { workerId } },
              data: { response: 'TAKEN', respondedAt: new Date() },
            });
          },
          { maxWait: 10_000, timeout: 15_000 },
        );
      });
    } catch (err) {
      if (haveLock) await this.release(lockKey, lockVal);
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2028' || err.code === 'P2024')
      ) {
        // The database is saturated. Tell the client to retry instead of failing with a 500.
        throw new CodedException(
          HttpStatus.SERVICE_UNAVAILABLE,
          ERROR_CODES.INTERNAL,
          'The service is busy. Please try again.',
          { code: 'BUSY_RETRY' },
        );
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = JSON.stringify(err.meta?.target ?? '');
        if (target.includes('worker_id'))
          throw new CodedException(
            HttpStatus.CONFLICT,
            ERROR_CODES.CONFLICT,
            'You already have an active job.',
            { code: 'ALREADY_ON_JOB' },
          );
        throw new RequestTakenException();
      }
      throw err;
    }

    // Winner is committed. Tell everyone, outside the transaction.
    const losers = await this.prisma.requestBroadcast.findMany({
      where: { jobId: job.id, response: 'TAKEN' },
      select: { workerId: true },
    });
    for (const l of losers)
      this.realtime.emitToUser(l.workerId, SOCKET_EVENTS.taken, {
        jobId: job.id,
        requestId,
        reason: 'TAKEN',
      });
    this.realtime.emitToUser(
      job.customerId,
      SOCKET_EVENTS.matched,
      { jobId: job.id, requestId, workerId },
      {
        title: 'Ranger found!',
        body: 'A Ranger accepted your request.',
        data: { jobId: job.id, type: 'matched' },
      },
    );
    this.realtime.emitToUser(workerId, SOCKET_EVENTS.matched, {
      jobId: job.id,
      requestId,
      workerId,
    });
    await this.transitions.notify(job.id);
    return { jobId: job.id, requestId };
  }

  private release(key: string, val: string) {
    return this.redis.client.eval(RELEASE_LOCK, 1, key, val).catch(() => undefined);
  }

  async decline(workerId: string, requestId: string) {
    const job = await this.prisma.job.findUnique({
      where: { requestId },
      select: { id: true, broadcastAttempt: true },
    });
    if (!job) throw notFound('Request not found');
    const res = await this.prisma.requestBroadcast.updateMany({
      where: { jobId: job.id, workerId, attempt: job.broadcastAttempt, response: 'PENDING' },
      data: { response: 'DECLINED', respondedAt: new Date() },
    });
    return { declined: res.count === 1 };
  }

  // ---- what a Ranger sees ---------------------------------------------------------------------------

  async incomingDto(jobId: string, workerId: string): Promise<IncomingRequest | null> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        request: {
          include: {
            category: { select: { slug: true } },
            media: { where: { status: 'UPLOADED' }, select: { kind: true } },
          },
        },
      },
    });
    if (!job) return null;
    const inv = await this.prisma.requestBroadcast.findFirst({
      where: { jobId, workerId, attempt: job.broadcastAttempt },
    });
    if (!inv) return null;
    const r = job.request;
    return {
      jobId: job.id,
      requestId: job.requestId,
      categorySlug: r.category.slug,
      description: r.description.slice(0, 300),
      city: r.city,
      pincode: r.pincode, // area only: the exact address is revealed after the Ranger wins the job
      distanceM: inv.distanceM,
      wave: inv.wave,
      urgency: r.urgency,
      scheduledFor: r.scheduledFor?.toISOString() ?? null,
      band: {
        scope: r.bandScope,
        minPaise: r.bandMinPaise,
        medianPaise: r.bandMedianPaise,
        maxPaise: r.bandMaxPaise,
      },
      deadline: job.broadcastDeadline?.toISOString() ?? null,
      photoCount: r.media.filter((m) => m.kind === 'PHOTO').length,
      hasVoiceNote: r.media.some((m) => m.kind === 'VOICE'),
    };
  }

  /** Reconnect safety net: everything currently open for this Ranger. */
  async incomingList(workerId: string): Promise<IncomingRequest[]> {
    const rows = await this.prisma.requestBroadcast.findMany({
      where: { workerId, response: 'PENDING', job: { status: 'BROADCASTING', workerId: null } },
      orderBy: { sentAt: 'desc' },
      take: 20,
      include: { job: { select: { id: true, broadcastAttempt: true } } },
    });
    const out: IncomingRequest[] = [];
    for (const b of rows) {
      if (b.attempt !== b.job.broadcastAttempt) continue;
      const dto = await this.incomingDto(b.jobId, workerId);
      if (dto) out.push(dto);
    }
    return out;
  }
}
