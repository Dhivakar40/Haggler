import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { decodeCursor, toPage, type AdminResolveDisputeInput } from '@haggler/shared';
import type { AuthAdmin } from '../common/decorators';
import { conflict, notFound } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { JobTransitions } from '../marketplace/job-transitions.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReputationService } from '../reputation/reputation.service';

/** D-080 (Sub-phase D): the dispute review queue. Resolving moves the job out of DISPUTED —
 * REFUND_CUSTOMER to REFUNDED (and counts against the Ranger's dispute rate, D-076's formula);
 * PAY_WORKER/NO_ACTION back to CONFIRMED_BY_CUSTOMER with no mark against the Ranger. Neither
 * path moves real money — see the Dispute model's own comment on why. */
@Injectable()
export class AdminDisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: JobTransitions,
    private readonly reputation: ReputationService,
    private readonly audit: AuditService,
  ) {}

  /** Oldest first — the ones waiting longest. */
  async queue(cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after: Prisma.DisputeWhereInput = c
      ? {
          OR: [
            { createdAt: { gt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { gt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.dispute.findMany({
      where: { AND: [{ status: 'OPEN' }, after] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    const jobIds = [...new Set(page.items.map((r) => r.jobId))];
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, customerId: true, workerId: true },
    });
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        jobId: r.jobId,
        customerId: jobById.get(r.jobId)?.customerId ?? null,
        workerId: jobById.get(r.jobId)?.workerId ?? null,
        raisedBy: r.raisedBy,
        role: r.role,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async resolve(disputeId: string, body: AdminResolveDisputeInput, admin: AuthAdmin) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw notFound('Dispute not found');
    if (dispute.status !== 'OPEN') throw conflict('This dispute is already resolved.');
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: dispute.jobId } });

    const to = body.resolution === 'REFUND_CUSTOMER' ? 'REFUNDED' : 'CONFIRMED_BY_CUSTOMER';
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.dispute.updateMany({
        where: { id: disputeId, status: 'OPEN' },
        data: {
          status: 'RESOLVED',
          resolution: body.resolution,
          resolutionNote: body.note,
          resolvedAt: new Date(),
          resolvedBy: admin.id,
        },
      });
      if (claimed.count !== 1) throw conflict('This dispute is already resolved.');
      await this.transitions.move(tx, {
        jobId: job.id,
        from: 'DISPUTED',
        to,
        actor: 'SYSTEM',
        actorUserId: admin.id,
        meta: { disputeId, resolution: body.resolution },
      });
      if (body.resolution === 'REFUND_CUSTOMER' && job.workerId) {
        await tx.workerStats.update({
          where: { workerUserId: job.workerId },
          data: { jobsDisputed: { increment: 1 } },
        });
        await this.reputation.recomputeWorkerLeague(tx, job.workerId);
      }
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'dispute.resolved',
          entityType: 'dispute',
          entityId: disputeId,
          after: { resolution: body.resolution },
        },
        tx,
      );
    });
    return { ok: true };
  }
}
