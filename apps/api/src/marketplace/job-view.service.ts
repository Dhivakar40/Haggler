import { Injectable } from '@nestjs/common';
import type { JobDto } from '@haggler/shared';
import { StorageService } from '../adapters/storage/storage.service';
import { EncryptionService } from '../common/crypto';
import { notFound } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { ratingAverage } from '../reputation/badge-tier';
import { MarketplaceConfig } from './marketplace-config.service';
import { estimateAcceptMinutes } from './sla';

const firstName = (full: string | null | undefined): string | null =>
  full ? (full.trim().split(/\s+/)[0] ?? null) : null;

/**
 * Builds the JobDto each party is allowed to see. Privacy rules live here, in one place:
 *  - the customer sees everything about their own job;
 *  - the matched Ranger sees the exact address and the customer's first name only AFTER matching;
 *  - the 4-digit arrival code is shown to the CUSTOMER only, and only while the Ranger is at the door;
 *  - anyone else gets a 404 (not a 403), so job ids cannot be probed.
 */
@Injectable()
export class JobViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly encryption: EncryptionService,
    private readonly env: EnvService,
    private readonly cfg: MarketplaceConfig,
  ) {}

  async loadForParty(jobId: string, viewerId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        request: { include: { category: true, media: { where: { status: 'UPLOADED' } } } },
        offers: { orderBy: { round: 'asc' } },
        photos: { where: { status: 'UPLOADED' } },
        thread: true,
      },
    });
    if (!job || (job.customerId !== viewerId && job.workerId !== viewerId))
      throw notFound('Job not found');
    return {
      job,
      role: (job.customerId === viewerId ? 'CUSTOMER' : 'WORKER') as 'CUSTOMER' | 'WORKER',
    };
  }

  async requestPoint(requestId: string): Promise<{ latitude: number; longitude: number }> {
    const rows = await this.prisma.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM service_requests WHERE id = ${requestId}::uuid`;
    const r = rows[0];
    if (!r) throw notFound('Request not found');
    return { latitude: r.lat, longitude: r.lng };
  }

  /** "Usually accepted in ~N min here": median time-to-match of recent jobs nearby, else category, else default. */
  async slaEstimateMinutes(categoryId: string, pincode: string): Promise<number> {
    const cfg = await this.cfg.get();
    const prefix = `${pincode.slice(0, 3)}%`;
    const local = await this.prisma.$queryRaw<{ s: number }[]>`
      SELECT EXTRACT(EPOCH FROM (j.matched_at - j.created_at))::float AS s
      FROM jobs j JOIN service_requests r ON r.id = j.request_id
      WHERE r.category_id = ${categoryId}::uuid AND r.pincode LIKE ${prefix} AND j.matched_at IS NOT NULL
      ORDER BY j.matched_at DESC LIMIT 50`;
    const category = await this.prisma.$queryRaw<{ s: number }[]>`
      SELECT EXTRACT(EPOCH FROM (j.matched_at - j.created_at))::float AS s
      FROM jobs j JOIN service_requests r ON r.id = j.request_id
      WHERE r.category_id = ${categoryId}::uuid AND j.matched_at IS NOT NULL
      ORDER BY j.matched_at DESC LIMIT 50`;
    return estimateAcceptMinutes({
      localSeconds: local.map((r) => r.s),
      categorySeconds: category.map((r) => r.s),
      minSamples: cfg.sla_min_samples,
      defaultMinutes: cfg.sla_default_minutes,
    }).minutes;
  }

  async build(jobId: string, viewerId: string): Promise<JobDto> {
    const { job, role } = await this.loadForParty(jobId, viewerId);
    const req = job.request;
    const matched = !!job.workerId;
    const point = await this.requestPoint(req.id);
    const showAddress = role === 'CUSTOMER' || matched;

    const [customer, worker, media, sla] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: job.customerId },
        select: { id: true, fullName: true },
      }),
      job.workerId
        ? this.prisma.user.findUnique({
            where: { id: job.workerId },
            select: { id: true, fullName: true, workerProfile: { select: { kycTier: true } } },
          })
        : Promise.resolve(null),
      Promise.all(
        req.media.map(async (m) => ({
          id: m.id,
          kind: m.kind,
          url: await this.storage.presignDownload(m.bucket, m.storageKey, 300),
        })),
      ),
      role === 'CUSTOMER' && (job.status === 'REQUESTED' || job.status === 'BROADCASTING')
        ? this.slaEstimateMinutes(req.categoryId, req.pincode)
        : Promise.resolve(0),
    ]);
    const stats = job.workerId
      ? await this.prisma.workerStats.findUnique({ where: { workerUserId: job.workerId } })
      : null;
    const myReview =
      job.status === 'CONFIRMED_BY_CUSTOMER'
        ? await this.prisma.review.findUnique({
            where: { jobId_raterRole: { jobId, raterRole: role } },
          })
        : null;

    const arrivalCode =
      role === 'CUSTOMER' &&
      job.status === 'ARRIVED' &&
      !job.arrivalVerifiedAt &&
      job.arrivalCodeEnc
        ? this.encryption.decrypt(job.arrivalCodeEnc)
        : null;

    return {
      id: job.id,
      requestId: job.requestId,
      viewerRole: role,
      status: job.status,
      categorySlug: req.category.slug,
      description: req.description,
      urgency: req.urgency,
      scheduledFor: req.scheduledFor?.toISOString() ?? null,
      city: req.city,
      pincode: req.pincode,
      addressLine: showAddress ? req.addressLine : null,
      location: showAddress ? point : null,
      band: {
        scope: req.bandScope,
        minPaise: req.bandMinPaise,
        medianPaise: req.bandMedianPaise,
        maxPaise: req.bandMaxPaise,
      },
      agreedPricePaise: job.agreedPricePaise,
      genderPreference: req.genderPreference,
      genderPreferenceMet: job.genderPreferenceMet,
      broadcast:
        role === 'CUSTOMER'
          ? {
              wave: job.currentWave,
              deadline: job.broadcastDeadline?.toISOString() ?? null,
              slaEstimateMinutes: sla,
            }
          : null,
      customer: { id: job.customerId, firstName: firstName(customer?.fullName) },
      worker: worker
        ? {
            id: worker.id,
            firstName: firstName(worker.fullName),
            kycTier: worker.workerProfile?.kycTier ?? 0,
            badgeTier: stats?.badgeTier ?? 'BRONZE',
            jobsCompleted: stats?.jobsCompleted ?? 0,
            ratingAvg:
              stats && stats.ratingCount > 0
                ? ratingAverage(stats.ratingSum, stats.ratingCount)
                : null,
            ratingCount: stats?.ratingCount ?? 0,
          }
        : null,
      review: {
        canReview: job.status === 'CONFIRMED_BY_CUSTOMER' && !myReview,
        submitted: !!myReview,
      },
      offers: job.offers.map((o) => ({
        id: o.id,
        round: o.round,
        fromRole: o.fromRole,
        amountPaise: o.amountPaise,
        outsideBand: o.outsideBand,
        status: o.status,
        expiresAt: o.expiresAt.toISOString(),
      })),
      arrivalCode,
      arrivalVerified: !!job.arrivalVerifiedAt,
      hasBeforePhoto: job.photos.some((p) => p.kind === 'BEFORE'),
      hasAfterPhoto: job.photos.some((p) => p.kind === 'AFTER'),
      paymentMethod: job.paymentMethod,
      cancellation:
        job.status === 'CANCELLED' || job.status.startsWith('NO_SHOW')
          ? {
              by: job.cancelledBy,
              reason: job.cancelReason,
              feeApplies: job.cancellationFeeApplies,
            }
          : null,
      media: showAddress ? media : [],
      threadId: job.thread?.id ?? null,
      createdAt: job.createdAt.toISOString(),
    };
  }
}
