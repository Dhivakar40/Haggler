import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * D-093 (Sub-phase J): the one place that puts an account on TEMPORARY_HOLD — a credible safety
 * signal (a theft/harassment incident report, or either party raising SOS) pending admin review,
 * never a permanent decision (that's AdminIncidentsService.resolve()'s SUSPEND path only, an
 * admin acting deliberately). Only moves ACTIVE -> TEMPORARY_HOLD: never clobbers an account
 * that is already SUSPENDED/DELETED/DELETION_PENDING, and never re-holds one already on hold
 * (holdStartedAt would otherwise reset and understate how long a report has waited).
 */
@Injectable()
export class AccountHoldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async holdForSafety(
    userId: string,
    reason: string,
    entity: { type: string; id: string },
    tx?: Tx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const claimed = await db.user.updateMany({
      where: { id: userId, status: 'ACTIVE' },
      data: { status: 'TEMPORARY_HOLD', holdStartedAt: new Date() },
    });
    if (claimed.count !== 1) return; // already held, or not eligible (suspended/deleted) — leave it
    await this.audit.record(
      {
        actorType: 'SYSTEM',
        action: 'account.temporary_hold',
        entityType: entity.type,
        entityId: entity.id,
        after: { userId, reason },
      },
      tx,
    );
  }
}
