import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { decodeCursor, toPage } from '@haggler/shared';
import type { AuthAdmin } from '../common/decorators';
import { conflict, notFound } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReputationService } from '../reputation/reputation.service';

/**
 * Review moderation (Phase 8, D-049 known gap closed): an admin can hide a fraudulent or abusive
 * review. Hiding reverses its rating out of the aggregate it fed (WorkerStats or CustomerStats)
 * and, if it affected a Ranger's league, recomputes that too — the same self-auditing pattern
 * as the wallet ledger (D-046): the aggregate is never "just edited," only ever moved by a real
 * event with its own record. No `unhide` exists yet — a one-way moderation action for now.
 */
@Injectable()
export class AdminReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reputation: ReputationService,
  ) {}

  /** Newest first. `revieweeId` narrows to one person's reviews (what an admin usually wants
   * after a complaint); omitted, it lists every review site-wide. */
  async queue(revieweeId: string | undefined, cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after: Prisma.ReviewWhereInput = c
      ? {
          OR: [
            { createdAt: { lt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.review.findMany({
      where: { AND: [revieweeId ? { revieweeId } : {}, after] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    // raterId/revieweeId are plain UUID columns (no Prisma relation, deliberately — see the
    // Review model), so names are fetched separately, same pattern as ReviewsService.forWorker().
    const userIds = [...new Set(page.items.flatMap((r) => [r.raterId, r.revieweeId]))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        jobId: r.jobId,
        raterRole: r.raterRole,
        raterName: nameById.get(r.raterId) ?? null,
        revieweeName: nameById.get(r.revieweeId) ?? null,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        hidden: !!r.hiddenAt,
        hiddenReason: r.hiddenReason,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async hide(reviewId: string, reason: string, admin: AuthAdmin): Promise<{ ok: true }> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw notFound('Review not found');
    if (review.hiddenAt) throw conflict('This review is already hidden.');

    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({
        where: { id: reviewId },
        data: { hiddenAt: new Date(), hiddenReason: reason },
      });
      if (review.raterRole === 'CUSTOMER') {
        // A customer's review of a Ranger fed WorkerStats and possibly the league.
        await tx.workerStats.update({
          where: { workerUserId: review.revieweeId },
          data: { ratingSum: { decrement: review.rating }, ratingCount: { decrement: 1 } },
        });
        await this.reputation.recomputeWorkerLeague(tx, review.revieweeId);
      } else {
        await tx.customerStats.update({
          where: { customerUserId: review.revieweeId },
          data: { ratingSum: { decrement: review.rating }, ratingCount: { decrement: 1 } },
        });
      }
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'review.hidden',
          entityType: 'review',
          entityId: reviewId,
          after: { reason },
        },
        tx,
      );
    });
    return { ok: true };
  }
}
