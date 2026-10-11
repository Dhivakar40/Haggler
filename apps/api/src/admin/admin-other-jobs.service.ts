import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { decodeCursor, OTHER_CATEGORY_SLUG, toPage } from '@haggler/shared';
import type { AuthAdmin } from '../common/decorators';
import { conflict, notFound } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { canTransition } from '../marketplace/job-state';
import { JobTransitions } from '../marketplace/job-transitions.service';
import { MatchingService } from '../marketplace/matching.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * D-080 (Sub-phase D): moderation for the "other" category (Phase 2/D-080's free-text catch-all,
 * no fixed price list to anchor it — the one category where a customer's own words are the whole
 * listing). Same "browse and search, not a report queue" shape as D-059's Contract/Campus
 * moderation — no report mechanic exists for jobs either. Cancellation is deliberately restricted
 * to REQUESTED/BROADCASTING/MATCHED/AGREED: job-state.ts's table only lets SYSTEM cancel a job
 * from those statuses (EN_ROUTE/ARRIVED/IN_PROGRESS have no SYSTEM-actor CANCELLED edge), so an
 * admin cannot unilaterally cancel once a Ranger is already underway — the same travel-fee
 * consideration the customer/Ranger's own cancel() already has to account for there.
 */
@Injectable()
export class AdminOtherJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: JobTransitions,
    private readonly matching: MatchingService,
    private readonly audit: AuditService,
  ) {}

  async browse(q: string | undefined, cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after: Prisma.ServiceRequestWhereInput = c
      ? {
          OR: [
            { createdAt: { lt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.serviceRequest.findMany({
      where: {
        AND: [
          { category: { slug: OTHER_CATEGORY_SLUG } },
          q ? { description: { contains: q, mode: 'insensitive' } } : {},
          after,
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { job: { select: { id: true, status: true } } },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((r) => ({
        requestId: r.id,
        jobId: r.job?.id ?? null,
        jobStatus: r.job?.status ?? null,
        customerId: r.customerId,
        description: r.description,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async cancel(jobId: string, reason: string, admin: AuthAdmin): Promise<{ ok: true }> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw notFound('Job not found');
    if (!canTransition(job.status, 'CANCELLED', 'SYSTEM'))
      throw conflict(`A job that is ${job.status} cannot be cancelled by an admin.`, {
        code: 'NOT_CANCELLABLE',
      });

    await this.prisma.$transaction(async (tx) => {
      await this.transitions.move(tx, {
        jobId,
        from: job.status,
        to: 'CANCELLED',
        actor: 'SYSTEM',
        actorUserId: admin.id,
        data: { cancelledAt: new Date(), cancelledBy: 'ADMIN', cancelReason: reason },
      });
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'other_job.cancelled',
          entityType: 'job',
          entityId: jobId,
          after: { reason },
        },
        tx,
      );
    });
    if (job.status === 'BROADCASTING' || job.status === 'REQUESTED')
      await this.matching.closeBroadcasts(jobId, 'CANCELLED');
    return { ok: true };
  }
}
