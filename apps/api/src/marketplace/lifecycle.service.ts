import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { ERROR_CODES, type PaymentMethodName } from './lifecycle.types';
import { StorageService } from '../adapters/storage/storage.service';
import { EncryptionService, hmacHex, safeEqualHex } from '../common/crypto';
import {
  CodedException,
  conflict,
  forbidden,
  notFound,
  unprocessable,
} from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReputationService } from '../reputation/reputation.service';
import { haversineMeters } from './geo';
import { CUSTOMER_CANCELLABLE } from './job-state';
import { JobTransitions } from './job-transitions.service';
import { JobViewService } from './job-view.service';
import { MarketplaceConfig } from './marketplace-config.service';
import { MatchingService } from './matching.service';
import { PresenceService } from './presence.service';

const IMG = ['image/jpeg', 'image/png', 'image/webp'];

/** The Ranger's and customer's actions on a matched job. Every method: authorise, validate, transition. */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: JobTransitions,
    private readonly view: JobViewService,
    private readonly presence: PresenceService,
    private readonly matching: MatchingService,
    private readonly storage: StorageService,
    private readonly encryption: EncryptionService,
    private readonly cfg: MarketplaceConfig,
    private readonly env: EnvService,
    private readonly reputation: ReputationService,
  ) {}

  private async workerJob(workerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.workerId !== workerId) throw notFound('Job not found');
    return job;
  }
  private async customerJob(customerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    return job;
  }
  private async done(jobId: string, viewerId: string) {
    await this.transitions.notify(jobId);
    return this.view.build(jobId, viewerId);
  }

  async enRoute(workerId: string, jobId: string) {
    const job = await this.workerJob(workerId, jobId);
    await this.prisma.$transaction((tx) =>
      this.transitions.move(tx, {
        jobId,
        from: job.status,
        to: 'EN_ROUTE',
        actor: 'WORKER',
        actorUserId: workerId,
        data: { enRouteAt: new Date() },
      }),
    );
    return this.done(jobId, workerId);
  }

  /**
   * "I have arrived." The server checks the Ranger's last GPS fix is within the geofence of the job
   * location, then generates a 4-digit code that ONLY the customer's app can show. The Ranger must
   * type it (verify-arrival), which proves they are physically with the customer.
   */
  async arrive(workerId: string, jobId: string) {
    const job = await this.workerJob(workerId, jobId);
    const cfg = await this.cfg.get();
    const [loc, dest] = await Promise.all([
      this.presence.lastLocation(workerId),
      this.view.requestPoint(job.requestId),
    ]);
    if (!loc || Date.now() - loc.at.getTime() > cfg.presence_ttl_seconds * 1000) {
      throw unprocessable('We could not get your location. Turn on GPS and try again.', {
        code: 'LOCATION_UNAVAILABLE',
      });
    }
    const distance = Math.round(haversineMeters(loc, dest));
    if (distance > cfg.arrival_geofence_m) {
      throw unprocessable(
        `You are ${distance} m away. Get within ${cfg.arrival_geofence_m} m of the address to mark arrival.`,
        { code: 'NOT_AT_LOCATION', distanceM: distance },
      );
    }
    const code = String(randomInt(0, 10_000)).padStart(4, '0');
    await this.prisma.$transaction((tx) =>
      this.transitions.move(tx, {
        jobId,
        from: job.status,
        to: 'ARRIVED',
        actor: 'WORKER',
        actorUserId: workerId,
        data: {
          arrivedAt: new Date(),
          arrivalCodeHash: this.hashCode(jobId, code),
          arrivalCodeEnc: this.encryption.encrypt(code),
          arrivalCodeTries: 0,
          arrivalVerifiedAt: null,
        },
        meta: { distanceM: distance },
      }),
    );
    return this.done(jobId, workerId);
  }

  private hashCode(jobId: string, code: string): string {
    return hmacHex(this.env.env.JWT_ACCESS_SECRET, `arrival:${jobId}:${code}`);
  }

  async verifyArrival(workerId: string, jobId: string, code: string) {
    const job = await this.workerJob(workerId, jobId);
    const cfg = await this.cfg.get();
    if (job.status !== 'ARRIVED') throw conflict('Mark arrival first.', { code: 'NOT_ARRIVED' });
    if (job.arrivalVerifiedAt) return this.done(jobId, workerId);
    if (job.arrivalCodeTries >= cfg.arrival_code_max_tries) {
      throw new CodedException(
        HttpStatus.TOO_MANY_REQUESTS,
        ERROR_CODES.RATE_LIMITED,
        'Too many wrong codes. Ask the customer to check, or cancel the job.',
        { code: 'CODE_LOCKED' },
      );
    }
    if (!job.arrivalCodeHash || !safeEqualHex(job.arrivalCodeHash, this.hashCode(jobId, code))) {
      // Atomic increment so parallel guesses cannot exceed the limit.
      await this.prisma.job.update({
        where: { id: jobId },
        data: { arrivalCodeTries: { increment: 1 } },
      });
      throw unprocessable('That code is not right.', { code: 'WRONG_CODE' });
    }
    await this.prisma.job.updateMany({
      where: { id: jobId, status: 'ARRIVED', arrivalVerifiedAt: null },
      data: { arrivalVerifiedAt: new Date() },
    });
    return this.done(jobId, workerId);
  }

  // ---- photos (before to start, after to complete) --------------------------------------------------

  async presignPhoto(
    workerId: string,
    jobId: string,
    input: { kind: 'BEFORE' | 'AFTER'; contentType: string; sizeBytes: number },
  ) {
    const job = await this.workerJob(workerId, jobId);
    const okStatus =
      input.kind === 'BEFORE'
        ? job.status === 'ARRIVED' || job.status === 'IN_PROGRESS'
        : job.status === 'IN_PROGRESS';
    if (!okStatus)
      throw conflict(
        input.kind === 'BEFORE'
          ? 'Take the before photo once you have arrived.'
          : 'Take the after photo while the job is in progress.',
        { code: 'WRONG_STATE' },
      );
    if (input.kind === 'BEFORE' && !job.arrivalVerifiedAt)
      throw conflict("Enter the customer's arrival code first.", { code: 'ARRIVAL_NOT_VERIFIED' });
    if (!IMG.includes(input.contentType.toLowerCase()))
      throw unprocessable('Photos must be JPEG, PNG or WebP.');
    const bucket = this.env.env.S3_BUCKET_MEDIA;
    const key = `jobs/${jobId}/${input.kind}-${randomUUID()}.${input.contentType.includes('png') ? 'png' : input.contentType.includes('webp') ? 'webp' : 'jpg'}`;
    const replaced: { bucket: string; storageKey: string }[] = [];
    const photo = await this.prisma.$transaction(async (tx) => {
      const old = await tx.jobPhoto.findMany({
        where: { jobId, kind: input.kind, status: { not: 'DELETED' } },
      });
      for (const o of old) {
        replaced.push({ bucket: o.bucket, storageKey: o.storageKey });
        await tx.jobPhoto.update({ where: { id: o.id }, data: { status: 'DELETED' } });
      }
      return tx.jobPhoto.create({
        data: {
          jobId,
          uploaderId: workerId,
          kind: input.kind,
          bucket,
          storageKey: key,
          contentType: input.contentType.toLowerCase(),
          sizeBytes: input.sizeBytes,
        },
      });
    });
    for (const r of replaced) this.storage.delete(r.bucket, r.storageKey).catch(() => undefined);
    const signed = await this.storage.presignUpload({
      bucket,
      key,
      contentType: photo.contentType,
      sizeBytes: input.sizeBytes,
    });
    return {
      photoId: photo.id,
      uploadUrl: signed.url,
      method: 'PUT' as const,
      headers: signed.headers,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  async confirmPhoto(workerId: string, photoId: string) {
    const p = await this.prisma.jobPhoto.findFirst({
      where: { id: photoId, uploaderId: workerId },
    });
    if (!p || p.status === 'DELETED') throw notFound('Photo not found');
    const size = await this.storage.headSize(p.bucket, p.storageKey);
    if (size === null) throw conflict('The photo has not been uploaded yet.');
    if (size !== p.sizeBytes)
      throw unprocessable(
        'The uploaded photo did not match its declared size. Please upload again.',
      );
    const u = await this.prisma.jobPhoto.update({
      where: { id: p.id },
      data: { status: 'UPLOADED' },
    });
    return { id: u.id, kind: u.kind, status: u.status };
  }

  async start(workerId: string, jobId: string) {
    const job = await this.workerJob(workerId, jobId);
    if (job.status === 'ARRIVED') {
      if (!job.arrivalVerifiedAt)
        throw conflict("Enter the customer's arrival code first.", {
          code: 'ARRIVAL_NOT_VERIFIED',
        });
      const before = await this.prisma.jobPhoto.count({
        where: { jobId, kind: 'BEFORE', status: 'UPLOADED' },
      });
      if (before === 0)
        throw unprocessable('A before photo is required to start.', {
          code: 'BEFORE_PHOTO_REQUIRED',
        });
    }
    await this.prisma.$transaction((tx) =>
      this.transitions.move(tx, {
        jobId,
        from: job.status,
        to: 'IN_PROGRESS',
        actor: 'WORKER',
        actorUserId: workerId,
        data: { startedAt: new Date() },
      }),
    );
    return this.done(jobId, workerId);
  }

  async complete(workerId: string, jobId: string, paymentMethod: PaymentMethodName) {
    const job = await this.workerJob(workerId, jobId);
    if (job.status === 'IN_PROGRESS') {
      const after = await this.prisma.jobPhoto.count({
        where: { jobId, kind: 'AFTER', status: 'UPLOADED' },
      });
      if (after === 0)
        throw unprocessable('An after photo is required to finish.', {
          code: 'AFTER_PHOTO_REQUIRED',
        });
    }
    await this.prisma.$transaction((tx) =>
      this.transitions.move(tx, {
        jobId,
        from: job.status,
        to: 'COMPLETED_BY_WORKER',
        actor: 'WORKER',
        actorUserId: workerId,
        data: { completedByWorkerAt: new Date(), paymentMethod },
      }),
    );
    return this.done(jobId, workerId);
  }

  /** Customer confirms the work. This is the moment a token is consumed (Phase 3 hooks in here)
   * and jobsCompleted increments, which can move a Ranger's badge tier even without a new review. */
  async confirm(customerId: string, jobId: string) {
    const job = await this.customerJob(customerId, jobId);
    await this.prisma.$transaction(async (tx) => {
      await this.transitions.move(tx, {
        jobId,
        from: job.status,
        to: 'CONFIRMED_BY_CUSTOMER',
        actor: 'CUSTOMER',
        actorUserId: customerId,
        data: { confirmedAt: new Date() },
      });
      if (job.workerId) {
        await tx.workerStats.upsert({
          where: { workerUserId: job.workerId },
          update: { jobsCompleted: { increment: 1 } },
          create: { workerUserId: job.workerId, jobsCompleted: 1 },
        });
        await this.reputation.recomputeWorkerLeague(tx, job.workerId);
      }
    });
    return this.done(jobId, customerId);
  }

  /**
   * Cancellation (D3). Either party may cancel until work starts. A fee flag is set only when the
   * CUSTOMER cancels after the Ranger has already travelled a meaningful distance
   * (`cancel_fee_travel_m`); before that, no fee. The flag is charged in Phase 3.
   */
  async cancel(userId: string, jobId: string, reason?: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || (job.customerId !== userId && job.workerId !== userId))
      throw notFound('Job not found');
    const role = job.customerId === userId ? 'CUSTOMER' : 'WORKER';
    if (role === 'CUSTOMER' && !CUSTOMER_CANCELLABLE.includes(job.status))
      throw conflict('This job can no longer be cancelled. Raise a dispute instead.', {
        code: 'NOT_CANCELLABLE',
      });

    let feeApplies = false;
    if (
      role === 'CUSTOMER' &&
      (job.status === 'EN_ROUTE' || job.status === 'ARRIVED') &&
      job.workerId
    ) {
      feeApplies =
        (await this.travelledMeters(job.id)) >= (await this.cfg.get()).cancel_fee_travel_m;
    }
    await this.prisma.$transaction(async (tx) => {
      await this.transitions.move(tx, {
        jobId,
        from: job.status,
        to: 'CANCELLED',
        actor: role,
        actorUserId: userId,
        data: {
          cancelledAt: new Date(),
          cancelledBy: role,
          cancelReason: reason ?? null,
          cancellationFeeApplies: feeApplies,
        },
        meta: { feeApplies },
      });
      // D-076: feeds the league's cancellation-rate factor. Only the Ranger's own cancellations
      // count against them — a customer cancelling is not the Ranger's fault.
      if (role === 'WORKER' && job.workerId) await this.markWorkerCancellation(tx, job.workerId);
    });
    if (job.status === 'BROADCASTING' || job.status === 'REQUESTED')
      await this.matching.closeBroadcasts(jobId, 'CANCELLED');
    return this.done(jobId, userId);
  }

  /** Increments the Ranger's cancellation counter and re-derives their league from it (D-076).
   * No jobsCompleted change, so a cancellation can only ever push a league down, never up. */
  private async markWorkerCancellation(tx: Prisma.TransactionClient, workerId: string) {
    await tx.workerStats.upsert({
      where: { workerUserId: workerId },
      update: { jobsCancelledByWorker: { increment: 1 } },
      create: { workerUserId: workerId, jobsCancelledByWorker: 1 },
    });
    await this.reputation.recomputeWorkerLeague(tx, workerId);
  }

  /** Straight-line distance between the first and latest GPS points recorded while en route. */
  private async travelledMeters(jobId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ d: number | null }[]>`
      SELECT ST_Distance(
               (SELECT location FROM job_locations WHERE job_id = ${jobId}::uuid ORDER BY recorded_at ASC LIMIT 1),
               (SELECT location FROM job_locations WHERE job_id = ${jobId}::uuid ORDER BY recorded_at DESC LIMIT 1))::float AS d`;
    return rows[0]?.d ?? 0;
  }

  /** No-shows. Customer: Ranger never arrived after the grace period. Ranger: customer absent after arrival. */
  async reportNoShow(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || (job.customerId !== userId && job.workerId !== userId))
      throw notFound('Job not found');
    const cfg = await this.cfg.get();
    const now = Date.now();
    if (job.customerId === userId) {
      if (job.status !== 'EN_ROUTE' || !job.enRouteAt)
        throw conflict('You can report a no-show only while the Ranger is on the way.', {
          code: 'WRONG_STATE',
        });
      const waited = (now - job.enRouteAt.getTime()) / 60_000;
      if (waited < cfg.worker_no_show_minutes)
        throw conflict(
          `Wait ${Math.ceil(cfg.worker_no_show_minutes - waited)} more minutes before reporting a no-show.`,
          { code: 'TOO_EARLY' },
        );
      await this.prisma.$transaction(async (tx) => {
        await this.transitions.move(tx, {
          jobId,
          from: 'EN_ROUTE',
          to: 'NO_SHOW_WORKER',
          actor: 'CUSTOMER',
          actorUserId: userId,
          data: { cancelledAt: new Date(), cancelledBy: 'SYSTEM', cancelReason: 'NO_SHOW_WORKER' },
        });
        if (job.workerId) await this.markWorkerCancellation(tx, job.workerId); // D-076
      });
    } else {
      if (job.status !== 'ARRIVED' || !job.arrivedAt)
        throw conflict('You can report a no-show only after arriving.', { code: 'WRONG_STATE' });
      const waited = (now - job.arrivedAt.getTime()) / 60_000;
      if (waited < cfg.customer_no_show_minutes)
        throw conflict(
          `Wait ${Math.ceil(cfg.customer_no_show_minutes - waited)} more minutes before reporting a no-show.`,
          { code: 'TOO_EARLY' },
        );
      await this.prisma.$transaction((tx) =>
        this.transitions.move(tx, {
          jobId,
          from: 'ARRIVED',
          to: 'NO_SHOW_CUSTOMER',
          actor: 'WORKER',
          actorUserId: userId,
          data: {
            cancelledAt: new Date(),
            cancelledBy: 'SYSTEM',
            cancelReason: 'NO_SHOW_CUSTOMER',
          },
        }),
      );
    }
    return this.done(jobId, userId);
  }

  assertParty(job: { customerId: string; workerId: string | null }, userId: string) {
    if (job.customerId !== userId && job.workerId !== userId) throw forbidden('Not your job.');
  }
}
