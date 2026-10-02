import { Injectable } from '@nestjs/common';
import type { JobStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  type CreateRequestInput,
  decodeCursor,
  MAX_REQUEST_PHOTOS,
  type MediaPresign,
  type MediaPresignRequest,
  PHOTO_MIME,
  SOCKET_EVENTS,
  toPage,
  VOICE_MIME,
} from '@haggler/shared';
import { StorageService } from '../adapters/storage/storage.service';
import { CatalogService } from '../catalog/catalog.service';
import { conflict, forbidden, notFound, unprocessable } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { isInIndia } from '../users/addresses.service';
import { WalletService } from '../wallet/wallet.service';
import { JobTransitions } from './job-transitions.service';
import { JobViewService } from './job-view.service';
import { MarketplaceConfig } from './marketplace-config.service';
import { MatchingService } from './matching.service';

const OPEN_STATES: JobStatus[] = [
  'REQUESTED',
  'BROADCASTING',
  'MATCHED',
  'NEGOTIATING',
  'AGREED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED_BY_WORKER',
];
const extFor = (ct: string): string =>
  (
    ({
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'audio/mp4': 'm4a',
      'audio/m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/mpeg': 'mp3',
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
    }) as Record<string, string>
  )[ct] ?? 'bin';

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly catalog: CatalogService,
    private readonly cfg: MarketplaceConfig,
    private readonly env: EnvService,
    private readonly matching: MatchingService,
    private readonly transitions: JobTransitions,
    private readonly view: JobViewService,
    private readonly realtime: RealtimeService,
    private readonly wallet: WalletService,
  ) {}

  // ---- media: photos (max 5) and one voice note (max 60 s) -------------------------------------

  async presignMedia(userId: string, req: MediaPresignRequest): Promise<MediaPresign> {
    const allowed: readonly string[] = req.kind === 'PHOTO' ? PHOTO_MIME : VOICE_MIME;
    if (!allowed.includes(req.contentType.toLowerCase()))
      throw unprocessable(`That file type is not allowed for a ${req.kind.toLowerCase()}.`);
    // A 60 s voice note at speech quality is well under 1 MB; 3 MB is a generous ceiling.
    if (req.kind === 'VOICE' && req.sizeBytes > 3 * 1024 * 1024)
      throw unprocessable('Voice note is too large for 60 seconds.');
    const bucket = this.env.env.S3_BUCKET_MEDIA;
    const key = `requests/${userId}/${randomUUID()}.${extFor(req.contentType.toLowerCase())}`;
    const row = await this.prisma.requestMedia.create({
      data: {
        ownerId: userId,
        kind: req.kind,
        bucket,
        storageKey: key,
        contentType: req.contentType.toLowerCase(),
        sizeBytes: req.sizeBytes,
        durationSeconds: req.durationSeconds ?? null,
      },
    });
    const signed = await this.storage.presignUpload({
      bucket,
      key,
      contentType: row.contentType,
      sizeBytes: req.sizeBytes,
    });
    return {
      mediaId: row.id,
      uploadUrl: signed.url,
      method: 'PUT',
      headers: signed.headers,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  async confirmMedia(userId: string, mediaId: string) {
    const m = await this.prisma.requestMedia.findFirst({ where: { id: mediaId, ownerId: userId } });
    if (!m || m.status === 'DELETED') throw notFound('Media not found');
    const size = await this.storage.headSize(m.bucket, m.storageKey);
    if (size === null) throw conflict('The file has not been uploaded yet.');
    if (size !== m.sizeBytes) {
      await this.storage.delete(m.bucket, m.storageKey).catch(() => undefined);
      await this.prisma.requestMedia.update({ where: { id: m.id }, data: { status: 'DELETED' } });
      throw unprocessable(
        'The uploaded file did not match its declared size. Please upload again.',
      );
    }
    const u = await this.prisma.requestMedia.update({
      where: { id: m.id },
      data: { status: 'UPLOADED' },
    });
    return { id: u.id, kind: u.kind, status: u.status };
  }

  // ---- create ------------------------------------------------------------------------------------

  async create(customerId: string, input: CreateRequestInput) {
    // These reads are all independent of one another (none needs another's result), so they go
    // over the wire together instead of as separate round trips. Against a local dev database the
    // difference is invisible; against a hosted one each round trip can be a meaningful fraction
    // of a second, and this endpoint alone used to make about a dozen of them in sequence.
    const [cfg, category, open, addr, media, isRush] = await Promise.all([
      this.cfg.get(),
      this.prisma.serviceCategory.findFirst({ where: { slug: input.categorySlug, isActive: true } }),
      this.prisma.job.count({ where: { customerId, status: { in: OPEN_STATES } } }),
      this.prisma.$queryRaw<
        {
          id: string;
          line1: string;
          line2: string | null;
          city: string;
          state: string;
          pincode: string;
          lat: number | null;
          lng: number | null;
        }[]
      >`
        SELECT id::text AS id, line1, line2, city, state, pincode, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
        FROM addresses WHERE id = ${input.addressId}::uuid AND user_id = ${customerId}::uuid`,
      input.mediaIds.length
        ? this.prisma.requestMedia.findMany({
            where: { id: { in: input.mediaIds }, ownerId: customerId },
          })
        : Promise.resolve([]),
      this.wallet.hasActivePlus(customerId),
    ]);

    if (!category) throw notFound(`Unknown category "${input.categorySlug}"`);

    if (open >= cfg.max_open_jobs_per_customer)
      throw conflict(
        `You can have up to ${cfg.max_open_jobs_per_customer} open requests at a time.`,
        { code: 'TOO_MANY_OPEN' },
      );

    const a = addr[0];
    if (!a) throw notFound('Address not found');
    if (a.lat === null || a.lng === null || !isInIndia(a.lat, a.lng))
      throw unprocessable(
        'This address has no location yet. Use "Use my current location" when saving it.',
        { code: 'ADDRESS_NEEDS_LOCATION' },
      );

    let scheduledFor: Date | null = null;
    if (input.urgency === 'SCHEDULED') {
      scheduledFor = new Date(input.scheduledFor as string);
      const mins = (scheduledFor.getTime() - Date.now()) / 60_000;
      if (mins < 30) throw unprocessable('Schedule at least 30 minutes ahead, or choose "Now".');
      if (mins > 14 * 24 * 60) throw unprocessable('You can schedule up to 14 days ahead.');
    }

    if (media.length !== input.mediaIds.length) throw notFound('Some attachments were not found');
    if (media.some((m) => m.status !== 'UPLOADED' || m.requestId))
      throw unprocessable('Some attachments are not uploaded or are already used.');
    if (media.filter((m) => m.kind === 'PHOTO').length > MAX_REQUEST_PHOTOS)
      throw unprocessable(`Attach at most ${MAX_REQUEST_PHOTOS} photos.`);
    if (media.filter((m) => m.kind === 'VOICE').length > 1)
      throw unprocessable('Attach at most one voice note.');

    const band = await this.catalog.getPriceBand(input.categorySlug, a.pincode, a.city);
    const addressLine = [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ');
    const startAt = scheduledFor
      ? new Date(scheduledFor.getTime() - cfg.scheduled_lead_minutes * 60_000)
      : new Date();
    // Phase 9 (D-069): an active Haggler Plus membership gets priority broadcast for free, on every
    // request, via the exact same isRush mechanism a one-off paid Rush fee uses (see rush() below
    // and MatchingService.advance()) — snapshotted at creation so a mid-broadcast membership expiry
    // never retroactively demotes a request already in flight. (Fetched up front, in parallel with
    // the other independent reads above.)

    const { requestId, jobId } = await this.prisma.$transaction(async (tx) => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO service_requests (id, customer_id, category_id, description, address_line, city, state, pincode, location,
                                      urgency, scheduled_for, gender_preference, band_scope, band_min_paise, band_median_paise, band_max_paise, updated_at)
        VALUES (${id}::uuid, ${customerId}::uuid, ${category.id}::uuid, ${input.description}, ${addressLine}, ${a.city}, ${a.state}, ${a.pincode},
                ST_SetSRID(ST_MakePoint(${a.lng}, ${a.lat}), 4326)::geography,
                ${input.urgency}::urgency, ${scheduledFor}, ${input.genderPreference}::gender_preference,
                ${band.scope}::price_band_scope, ${band.minPaise}, ${band.medianPaise}, ${band.maxPaise}, now())`;
      const job = await tx.job.create({
        data: { requestId: id, customerId, nextWaveAt: startAt, isRush },
      });
      // D-037/D-038: reserve one token now, before the request can broadcast, so a customer can
      // never end up confirming more jobs than they have paid for. Throws INSUFFICIENT_TOKENS.
      await this.wallet.hold(tx, customerId, job.id);
      if (input.mediaIds.length)
        await tx.requestMedia.updateMany({
          where: { id: { in: input.mediaIds } },
          data: { requestId: id },
        });
      await tx.jobEvent.create({
        data: { jobId: job.id, fromStatus: null, toStatus: 'REQUESTED', actorUserId: customerId },
      });
      return { requestId: id, jobId: job.id };
    });

    // Immediate requests start broadcasting right away; scheduled ones wait for the scheduler.
    if (input.urgency === 'IMMEDIATE') await this.matching.advance(jobId);
    return { requestId, dto: await this.view.build(jobId, customerId) };
  }

  // ---- read / cancel / rebroadcast ---------------------------------------------------------------

  async getByRequest(requestId: string, userId: string) {
    const job = await this.prisma.job.findUnique({ where: { requestId }, select: { id: true } });
    if (!job) throw notFound('Request not found');
    return this.view.build(job.id, userId);
  }

  /**
   * Re-broadcast after a timeout (D3). Starts a new attempt from wave 1 so Rangers who were invited
   * before (and may be free now) are invited again. Only the customer, only when no one accepted.
   */
  async rebroadcast(customerId: string, requestId: string) {
    const job = await this.prisma.job.findUnique({ where: { requestId } });
    if (!job || job.customerId !== customerId) throw notFound('Request not found');
    const cfg = await this.cfg.get();
    const timedOut =
      job.status === 'BROADCASTING' &&
      job.currentWave >= cfg.broadcast_radii_m.length &&
      !job.workerId;
    if (!timedOut)
      throw conflict('You can only re-broadcast after a request has timed out.', {
        code: 'NOT_TIMED_OUT',
      });
    await this.prisma.job.updateMany({
      where: { id: job.id, status: 'BROADCASTING', workerId: null },
      data: {
        currentWave: 0,
        broadcastAttempt: { increment: 1 },
        nextWaveAt: new Date(),
        broadcastDeadline: null,
      },
    });
    await this.prisma.jobEvent.create({
      data: {
        jobId: job.id,
        fromStatus: 'BROADCASTING',
        toStatus: 'BROADCASTING',
        actorUserId: customerId,
        meta: { rebroadcast: true },
      },
    });
    await this.matching.advance(job.id);
    return this.view.build(job.id, customerId);
  }

  /** Customer cancels a request that has not been matched yet. After matching use POST /jobs/:id/cancel. */
  async cancelRequest(customerId: string, requestId: string) {
    const job = await this.prisma.job.findUnique({ where: { requestId } });
    if (!job || job.customerId !== customerId) throw notFound('Request not found');
    if (job.status !== 'REQUESTED' && job.status !== 'BROADCASTING') {
      throw conflict('This request has already been matched. Cancel the job instead.', {
        code: 'ALREADY_MATCHED',
      });
    }
    await this.prisma.$transaction((tx) =>
      this.transitions.move(tx, {
        jobId: job.id,
        from: job.status,
        to: 'CANCELLED',
        actor: 'CUSTOMER',
        actorUserId: customerId,
        data: {
          cancelledAt: new Date(),
          cancelledBy: 'CUSTOMER',
          cancelReason: 'Cancelled by customer',
          nextWaveAt: null,
        },
      }),
    );
    await this.matching.closeBroadcasts(job.id, 'CANCELLED');
    return this.view.build(job.id, customerId);
  }

  /** Rush fee (Phase 9, D-069): starts a payment order for skipping wave sequencing on this
   * request. See WalletService.createRushOrder for the eligibility checks. */
  async rush(customerId: string, requestId: string) {
    const job = await this.prisma.job.findUnique({ where: { requestId }, select: { id: true } });
    if (!job) throw notFound('Request not found');
    return this.wallet.createRushOrder(customerId, job.id);
  }

  async listJobs(
    userId: string,
    role: 'CUSTOMER' | 'WORKER' | undefined,
    cursor: string | undefined,
    limit: number,
  ) {
    const c = cursor ? decodeCursor(cursor) : null;
    const roleWhere =
      role === 'CUSTOMER'
        ? { customerId: userId }
        : role === 'WORKER'
          ? { workerId: userId }
          : { OR: [{ customerId: userId }, { workerId: userId }] };
    const after = c
      ? {
          OR: [
            { createdAt: { lt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.job.findMany({
      where: { AND: [roleWhere, after] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { request: { include: { category: { select: { slug: true } } } } },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((j) => ({
        id: j.id,
        viewerRole: (j.customerId === userId ? 'CUSTOMER' : 'WORKER') as 'CUSTOMER' | 'WORKER',
        status: j.status,
        categorySlug: j.request.category.slug,
        description: j.request.description.slice(0, 140),
        agreedPricePaise: j.agreedPricePaise,
        createdAt: j.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** For the Ranger: guard that a request id belongs to a broadcast they were invited to. */
  async assertInvited(workerId: string, requestId: string) {
    const job = await this.prisma.job.findUnique({
      where: { requestId },
      select: { id: true, broadcastAttempt: true },
    });
    if (!job) throw notFound('Request not found');
    const inv = await this.prisma.requestBroadcast.findFirst({
      where: { jobId: job.id, workerId, attempt: job.broadcastAttempt },
    });
    if (!inv) throw forbidden('You were not invited to this request.');
    return { jobId: job.id, invitation: inv };
  }

  notifyCustomer(customerId: string, payload: Record<string, unknown>) {
    this.realtime.emitToUser(customerId, SOCKET_EVENTS.jobUpdated, payload);
  }
}
