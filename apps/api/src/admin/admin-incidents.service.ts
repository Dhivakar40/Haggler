import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { decodeCursor, toPage, type AdminResolveIncidentInput } from '@haggler/shared';
import type { AuthAdmin } from '../common/decorators';
import { conflict, notFound } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../adapters/storage/storage.service';

/**
 * D-093 (Sub-phase J3): the incident-report review queue. A theft/harassment report (or an SOS —
 * see sos.service.ts) already put the accused account on TEMPORARY_HOLD automatically; this is
 * where an admin actually decides what happens next — CLEAR releases the hold, SUSPEND is the
 * one deliberate path to a permanent ban. Neither is automatic; see UserStatus's own comments.
 */
@Injectable()
export class AdminIncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Oldest first — the ones waiting longest, which is also the ones most likely to have
   * blown past the 24h review SLA a TEMPORARY_HOLD is meant to be reviewed within. */
  async queue(cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after: Prisma.IncidentReportWhereInput = c
      ? {
          OR: [
            { createdAt: { gt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { gt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.incidentReport.findMany({
      where: { AND: [{ status: { in: ['OPEN', 'REVIEWING'] } }, after] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    const holdCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return {
      items: page.items.map((r) => ({
        id: r.id,
        jobId: r.jobId,
        reporterId: r.reporterId,
        reporterRole: r.reporterRole,
        reason: r.reason,
        description: r.description,
        status: r.status,
        suspendedUserId: r.suspendedUserId,
        createdAt: r.createdAt.toISOString(),
        overdueForReview: r.createdAt < holdCutoff,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Every evidence access is audited — this pulls the job's own trail (photos, event log,
   * chat) as the thing an admin reviews a report against. Presigned URLs only, same TTL
   * discipline as any other admin media view. */
  async evidence(incidentId: string, admin: AuthAdmin, ip: string | undefined) {
    const report = await this.prisma.incidentReport.findUnique({ where: { id: incidentId } });
    if (!report) throw notFound('Incident report not found');
    const job = await this.prisma.job.findUniqueOrThrow({
      where: { id: report.jobId },
      include: {
        photos: { where: { status: 'UPLOADED' } },
        events: { orderBy: { createdAt: 'asc' } },
        thread: { include: { messages: { orderBy: { createdAt: 'asc' } } } },
      },
    });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'incident.evidence_viewed',
      entityType: 'incident_report',
      entityId: incidentId,
      ip,
    });
    const photos = await Promise.all(
      job.photos.map(async (p) => ({
        id: p.id,
        kind: p.kind,
        url: await this.storage.presignDownload(p.bucket, p.storageKey),
      })),
    );
    return {
      incidentId,
      jobId: job.id,
      reason: report.reason,
      description: report.description,
      photos,
      events: job.events.map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorUserId: e.actorUserId,
        createdAt: e.createdAt.toISOString(),
      })),
      chat: (job.thread?.messages ?? []).map((m) => ({
        senderId: m.senderId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async resolve(incidentId: string, body: AdminResolveIncidentInput, admin: AuthAdmin) {
    const report = await this.prisma.incidentReport.findUnique({ where: { id: incidentId } });
    if (!report) throw notFound('Incident report not found');
    if (report.status === 'RESOLVED') throw conflict('This report is already resolved.');

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.incidentReport.updateMany({
        where: { id: incidentId, status: { in: ['OPEN', 'REVIEWING'] } },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: admin.id },
      });
      if (claimed.count !== 1) throw conflict('This report is already resolved.');

      if (report.suspendedUserId) {
        if (body.resolution === 'CLEAR') {
          await tx.user.updateMany({
            where: { id: report.suspendedUserId, status: 'TEMPORARY_HOLD' },
            data: { status: 'ACTIVE', holdStartedAt: null },
          });
        } else {
          await tx.user.update({
            where: { id: report.suspendedUserId },
            data: { status: 'SUSPENDED', holdStartedAt: null },
          });
        }
      }
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: `incident.${body.resolution.toLowerCase()}`,
          entityType: 'incident_report',
          entityId: incidentId,
          after: { resolution: body.resolution, suspendedUserId: report.suspendedUserId },
        },
        tx,
      );
    });
    return { id: incidentId, resolution: body.resolution };
  }
}
