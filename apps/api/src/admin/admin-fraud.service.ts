import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { decodeCursor, toPage } from '@haggler/shared';
import type { AuthAdmin } from '../common/decorators';
import { conflict, notFound } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * D-093 (Sub-phase K1/K2): the fraud review queue, and multi-account candidates. Every method
 * here is read-only or a plain status change — nothing moves money or a league. An admin
 * reviewing a candidate decides what to do with the existing dispute/incident-report/suspension
 * tools, same pattern as AdminIncidentsService.
 */
@Injectable()
export class AdminFraudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Oldest first — the ones waiting longest. */
  async queue(cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after: Prisma.FraudReviewItemWhereInput = c
      ? {
          OR: [
            { createdAt: { gt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { gt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.fraudReviewItem.findMany({
      where: { AND: [{ status: { in: ['OPEN', 'REVIEWING'] } }, after] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        kind: r.kind,
        subjectUserId: r.subjectUserId,
        relatedUserId: r.relatedUserId,
        detail: r.detail,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Acknowledges a fraud signal as reviewed — never itself changes a balance or a league,
   * only its own status. Whatever the admin decided to do about it (if anything) goes through
   * the dispute/incident-report/suspension tools already built for that. */
  async resolve(itemId: string, admin: AuthAdmin, note: string) {
    const item = await this.prisma.fraudReviewItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound('Fraud review item not found');
    if (item.status === 'RESOLVED') throw conflict('This item is already resolved.');

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.fraudReviewItem.updateMany({
        where: { id: itemId, status: { in: ['OPEN', 'REVIEWING'] } },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: admin.id },
      });
      if (claimed.count !== 1) throw conflict('This item is already resolved.');
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'fraud.resolved',
          entityType: 'fraud_review_item',
          entityId: itemId,
          after: { note },
        },
        tx,
      );
    });
    return { id: itemId };
  }

  /** D-093 (K2): accounts sharing a registered device — the only identifier strong enough to
   * check against in this schema. Phone is already globally unique per account (User.phone),
   * so a duplicate phone is structurally impossible already; this codebase stores no payment-
   * instrument fingerprint (no card/VPA data is kept — the Razorpay sandbox integration never
   * needed one), so that half of "phone/device/payment" cannot be checked here. Flagged, not
   * silently skipped — see docs/DECISIONS.md D-093. Read-only: nothing is held or suspended by
   * this call, it only surfaces candidates for a human to look at. */
  async multiAccountCandidates(limit: number) {
    const rows = await this.prisma.$queryRaw<{ device_id: string; user_ids: string[] }[]>`
      SELECT device_id, array_agg(DISTINCT user_id::text) AS user_ids
      FROM devices
      GROUP BY device_id
      HAVING COUNT(DISTINCT user_id) > 1
      LIMIT ${limit}`;
    return {
      items: rows.map((r) => ({ deviceId: r.device_id, userIds: r.user_ids })),
    };
  }
}
