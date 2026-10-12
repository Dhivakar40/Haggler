import { Injectable } from '@nestjs/common';
import type { IncidentReportDto, ReportIncidentInput } from '@haggler/shared';
import { notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { AccountHoldService } from '../users/account-hold.service';

/** Reasons credible enough on their own to hold the accused account automatically, pending
 * admin review — not an exhaustive judgment of guilt, just "serious enough to act on sight." */
const AUTO_HOLD_REASONS = new Set(['THEFT', 'HARASSMENT']);

/**
 * D-093 (Sub-phase J3): a formal safety incident report on a job, reviewed with the job's own
 * trail (JobEvent, photos, GPS, chat) as evidence — distinct from DisputeService (money/quality)
 * and SosService (in-the-moment emergency, which has its own hold trigger — see sos.service.ts).
 */
@Injectable()
export class IncidentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hold: AccountHoldService,
  ) {}

  async report(reporterId: string, jobId: string, input: ReportIncidentInput): Promise<IncidentReportDto> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || (job.customerId !== reporterId && job.workerId !== reporterId))
      throw notFound('Job not found');

    const reporterRole = job.customerId === reporterId ? 'CUSTOMER' : 'WORKER';
    const accusedUserId = reporterRole === 'CUSTOMER' ? job.workerId : job.customerId;

    const report = await this.prisma.incidentReport.create({
      data: {
        jobId,
        reporterId,
        reporterRole,
        reason: input.reason,
        description: input.description,
        suspendedUserId: accusedUserId,
      },
    });

    // J1/J3: theft or harassment is credible enough on its own to hold the accused account
    // immediately, pending admin review (the master prompt's "within 24h" — see AccountHold
    // Service's comment on holdStartedAt, which is what lets an admin queue measure that SLA).
    // This is never a permanent decision — only AdminIncidentsService.resolve()'s SUSPEND path is.
    if (accusedUserId && AUTO_HOLD_REASONS.has(input.reason)) {
      await this.hold.holdForSafety(accusedUserId, input.reason, {
        type: 'incident_report',
        id: report.id,
      });
    }

    return {
      id: report.id,
      jobId: report.jobId,
      reporterRole: report.reporterRole,
      reason: report.reason,
      description: report.description,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      resolvedAt: report.resolvedAt ? report.resolvedAt.toISOString() : null,
    };
  }
}
