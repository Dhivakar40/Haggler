import { Injectable } from '@nestjs/common';
import { type OfferInput, SOCKET_EVENTS } from '@haggler/shared';
import { conflict, forbidden, notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { JobTransitions } from './job-transitions.service';
import { JobViewService } from './job-view.service';
import { MarketplaceConfig } from './marketplace-config.service';
import { assertCanRespond, evaluateNewOffer, type Role } from './negotiation';

/** Negotiation state machine (D3): offer / counter / accept / reject, max 3 rounds, offers expire. */
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: MarketplaceConfig,
    private readonly transitions: JobTransitions,
    private readonly view: JobViewService,
    private readonly realtime: RealtimeService,
  ) {}

  private roleOf(job: { customerId: string; workerId: string | null }, userId: string): Role {
    if (job.customerId === userId) return 'CUSTOMER';
    if (job.workerId === userId) return 'WORKER';
    throw notFound('Job not found');
  }

  async create(userId: string, jobId: string, input: OfferInput) {
    const cfg = await this.cfg.get();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({
        where: { id: jobId },
        include: { request: true, offers: { orderBy: { round: 'asc' } } },
      });
      if (!job) throw notFound('Job not found');
      const role = this.roleOf(job, userId);
      if (job.status !== 'MATCHED' && job.status !== 'NEGOTIATING')
        throw conflict('Prices can only be negotiated after matching and before agreeing.', {
          code: 'NOT_NEGOTIATING',
        });

      const { round, outsideBand, counters } = evaluateNewOffer({
        offers: job.offers,
        role,
        amountPaise: input.amountPaise,
        band: { minPaise: job.request.bandMinPaise, maxPaise: job.request.bandMaxPaise },
        confirmOutsideBand: input.confirmOutsideBand === true,
        now,
      });

      // Anything still pending (live or stale) is closed before the new offer opens (one PENDING at a time).
      await tx.offer.updateMany({
        where: { jobId, status: 'PENDING' },
        data: { status: counters ? 'COUNTERED' : 'EXPIRED' },
      });
      await tx.offer.create({
        data: {
          jobId,
          round,
          fromRole: role,
          amountPaise: input.amountPaise,
          outsideBand,
          expiresAt: new Date(now.getTime() + cfg.offer_ttl_seconds * 1000),
        },
      });
      if (job.status === 'MATCHED') {
        await this.transitions.move(tx, {
          jobId,
          from: 'MATCHED',
          to: 'NEGOTIATING',
          actor: role,
          actorUserId: userId,
        });
      }
    });
    return this.afterChange(jobId, userId);
  }

  /** Counter = a new offer that answers the pending one (same rules; only the other party may). */
  async counter(userId: string, offerId: string, input: OfferInput) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw notFound('Offer not found');
    return this.create(userId, offer.jobId, input);
  }

  async accept(userId: string, offerId: string, confirmOutsideBand: boolean) {
    const now = new Date();
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { job: true },
    });
    if (!offer) throw notFound('Offer not found');
    const role = this.roleOf(offer.job, userId);
    assertCanRespond(offer, role, now, confirmOutsideBand);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.offer.updateMany({
        where: { id: offerId, status: 'PENDING', expiresAt: { gt: now } },
        data: { status: 'ACCEPTED' },
      });
      if (claimed.count !== 1)
        throw conflict('That offer is no longer open.', { code: 'OFFER_CLOSED' });
      await this.transitions.move(tx, {
        jobId: offer.jobId,
        from: 'NEGOTIATING',
        to: 'AGREED',
        actor: role,
        actorUserId: userId,
        data: { agreedPricePaise: offer.amountPaise, agreedAt: now },
        meta: { offerId, amountPaise: offer.amountPaise },
      });
    });
    return this.afterChange(offer.jobId, userId);
  }

  /** Walking away ends the negotiation and cancels the job (no fee: nobody has travelled yet). */
  async reject(userId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { job: true },
    });
    if (!offer) throw notFound('Offer not found');
    const role = this.roleOf(offer.job, userId);
    if (offer.fromRole === role) throw forbidden('You cannot reject your own offer.');
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.offer.updateMany({
        where: { id: offerId, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });
      if (claimed.count !== 1)
        throw conflict('That offer is no longer open.', { code: 'OFFER_CLOSED' });
      await this.transitions.move(tx, {
        jobId: offer.jobId,
        from: 'NEGOTIATING',
        to: 'CANCELLED',
        actor: role,
        actorUserId: userId,
        data: { cancelledAt: new Date(), cancelledBy: role, cancelReason: 'NEGOTIATION_REJECTED' },
      });
    });
    return this.afterChange(offer.jobId, userId);
  }

  /**
   * Housekeeping (scheduler): offers past their expiry become EXPIRED; when no rounds are left, or
   * a matched job has seen no offer for `negotiation_idle_minutes`, the job is cancelled so the
   * Ranger is freed.
   */
  async sweep(now = new Date()): Promise<number> {
    const cfg = await this.cfg.get();
    const expired = await this.prisma.offer.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      select: { id: true, jobId: true },
    });
    if (expired.length)
      await this.prisma.offer.updateMany({
        where: { id: { in: expired.map((o) => o.id) } },
        data: { status: 'EXPIRED' },
      });
    for (const e of expired)
      this.realtime.emitToUsers(await this.parties(e.jobId), SOCKET_EVENTS.offerUpdated, {
        jobId: e.jobId,
      });

    let cancelled = 0;
    const idleCutoff = new Date(now.getTime() - cfg.negotiation_idle_minutes * 60_000);
    const candidates = await this.prisma.job.findMany({
      where: { status: { in: ['MATCHED', 'NEGOTIATING'] } },
      include: { offers: true },
    });
    for (const j of candidates) {
      const live = j.offers.some((o) => o.status === 'PENDING' && o.expiresAt > now);
      if (live) continue;
      const exhausted = j.offers.length >= 3;
      const lastAt = Math.max(
        j.matchedAt?.getTime() ?? 0,
        ...j.offers.map((o) => o.expiresAt.getTime()),
      );
      const idle = new Date(lastAt) < idleCutoff;
      if (!exhausted && !idle) continue;
      try {
        await this.prisma.$transaction((tx) =>
          this.transitions.move(tx, {
            jobId: j.id,
            from: j.status,
            to: 'CANCELLED',
            actor: 'SYSTEM',
            data: {
              cancelledAt: now,
              cancelledBy: 'SYSTEM',
              cancelReason: exhausted ? 'NEGOTIATION_TIMEOUT' : 'NEGOTIATION_IDLE',
            },
          }),
        );
        await this.transitions.notify(j.id);
        cancelled += 1;
      } catch {
        /* someone else moved it first: fine */
      }
    }
    return expired.length + cancelled;
  }

  private async parties(jobId: string): Promise<string[]> {
    const j = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { customerId: true, workerId: true },
    });
    return j ? [j.customerId, ...(j.workerId ? [j.workerId] : [])] : [];
  }

  private async afterChange(jobId: string, viewerId: string) {
    this.realtime.emitToUsers(await this.parties(jobId), SOCKET_EVENTS.offerUpdated, { jobId });
    await this.transitions.notify(jobId);
    return this.view.build(jobId, viewerId);
  }
}
