import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { decodeCursor, toPage } from '@haggler/shared';
import type { AuthAdmin } from '../common/decorators';
import { conflict, notFound } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** D-080 (Sub-phase C): the SOS review queue — a DISPUTE_AGENT/SUPER_ADMIN looks at open safety
 * alerts and marks them resolved once followed up. */
@Injectable()
export class AdminSosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Open alerts first (oldest first — the ones waiting longest), then resolved ones newest first. */
  async queue(cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after: Prisma.SosAlertWhereInput = c
      ? {
          OR: [
            { createdAt: { gt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { gt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.sosAlert.findMany({
      where: { AND: [{ status: 'OPEN' }, after] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    const jobIds = [...new Set(page.items.map((r) => r.jobId))];
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, customerId: true, workerId: true, status: true },
    });
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        jobId: r.jobId,
        jobStatus: jobById.get(r.jobId)?.status ?? null,
        triggeredBy: r.triggeredBy,
        role: r.role,
        latitude: r.latitude,
        longitude: r.longitude,
        note: r.note,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async resolve(alertId: string, admin: AuthAdmin): Promise<{ ok: true }> {
    const alert = await this.prisma.sosAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw notFound('Alert not found');
    if (alert.status === 'RESOLVED') throw conflict('This alert is already resolved.');

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.sosAlert.updateMany({
        where: { id: alertId, status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: admin.id },
      });
      if (claimed.count !== 1) throw conflict('This alert is already resolved.');
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'sos.resolved',
          entityType: 'sos_alert',
          entityId: alertId,
        },
        tx,
      );
    });
    return { ok: true };
  }
}
