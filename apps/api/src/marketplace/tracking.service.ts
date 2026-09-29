import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { TrackDto } from '@haggler/shared';
import { sha256Hex } from '../common/crypto';
import { conflict, notFound } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobViewService } from './job-view.service';

const TRACKABLE = ['AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
const SHARE_TTL_HOURS = 12;

/** Live tracking of the Ranger (customer, or a trusted contact through a share link). */
@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly view: JobViewService,
    private readonly env: EnvService,
  ) {}

  private async snapshot(
    jobId: string,
    status: TrackDto['status'],
    requestId: string,
    trailLimit: number,
  ): Promise<TrackDto> {
    const rows = await this.prisma.$queryRaw<
      { lat: number; lng: number; acc: number | null; at: Date }[]
    >`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, accuracy_m AS acc, recorded_at AS at
      FROM job_locations WHERE job_id = ${jobId}::uuid ORDER BY recorded_at DESC LIMIT ${trailLimit}`;
    const latest = rows[0];
    const showLive = TRACKABLE.includes(status);
    return {
      jobId,
      status,
      worker:
        latest && showLive
          ? {
              latitude: latest.lat,
              longitude: latest.lng,
              accuracyM: latest.acc,
              recordedAt: latest.at.toISOString(),
            }
          : null,
      trail: showLive
        ? rows
            .reverse()
            .map((r) => ({ latitude: r.lat, longitude: r.lng, recordedAt: r.at.toISOString() }))
        : [],
      destination: await this.view.requestPoint(requestId),
    };
  }

  /** The customer (and the Ranger, for their own trail) can see it; nobody else. */
  async track(userId: string, jobId: string): Promise<TrackDto> {
    const { job } = await this.view.loadForParty(jobId, userId);
    return this.snapshot(job.id, job.status, job.requestId, 100);
  }

  /**
   * A live link the customer sends to someone they trust. The URL holds a random 256-bit token;
   * only its hash is stored, so a database leak does not leak working links. It expires after 12 h
   * or when the customer revokes it, and it shows position and status only (no phone, no chat).
   */
  async createShare(customerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    if (
      !job.workerId ||
      !['MATCHED', 'NEGOTIATING', 'AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(
        job.status,
      )
    ) {
      throw conflict('You can share a live link while a Ranger is assigned to your job.', {
        code: 'NOT_SHAREABLE',
      });
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SHARE_TTL_HOURS * 3_600_000);
    await this.prisma.trustedShare.create({
      data: { jobId, tokenHash: sha256Hex(token), expiresAt, createdBy: customerId },
    });
    return {
      url: `${this.env.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/t/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async revokeShares(customerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    const r = await this.prisma.trustedShare.updateMany({
      where: { jobId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: r.count };
  }

  /** Public (no login). Unknown, expired and revoked tokens are indistinguishable: 404. */
  async publicView(token: string) {
    const share = await this.prisma.trustedShare.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { job: { include: { request: { include: { category: true } } } } },
    });
    if (!share || share.revokedAt || share.expiresAt <= new Date())
      throw notFound('This link is not valid.');
    const job = share.job;
    const worker = job.workerId
      ? await this.prisma.user.findUnique({
          where: { id: job.workerId },
          select: { fullName: true },
        })
      : null;
    const snap = await this.snapshot(job.id, job.status, job.requestId, 30);
    return {
      status: job.status,
      category: job.request.category.slug,
      rangerFirstName: worker?.fullName?.trim().split(/\s+/)[0] ?? null,
      worker: snap.worker,
      trail: snap.trail,
      destination: snap.destination,
      expiresAt: share.expiresAt.toISOString(),
    };
  }
}
