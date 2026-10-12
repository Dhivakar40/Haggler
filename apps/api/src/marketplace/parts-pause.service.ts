import { Injectable } from '@nestjs/common';
import type { RequestPauseInput } from '@haggler/shared';
import { conflict, notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { FeeService } from './fee.service';
import { travelledMeters } from './geo';
import { JobTransitions } from './job-transitions.service';
import { JobViewService } from './job-view.service';

/**
 * D-087 (Sub-phase I, core only): the Ranger pauses an in-progress job to go fetch a part.
 * `max_parts_extensions` caps how many times one job can be paused; everything past the
 * pause/resume/reject-and-settle mechanism here (reminders, Wait/Cancel/Rebook choice at the
 * end of the promised window, reserved return slots, reliability-score penalties on a missed
 * slot, item-handover photo records) is deferred — see docs/DECISIONS.md.
 */
@Injectable()
export class PartsPauseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: JobTransitions,
    private readonly view: JobViewService,
    private readonly fee: FeeService,
  ) {}

  private async workerJob(workerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.workerId !== workerId) throw notFound('Job not found');
    return job;
  }

  /** Ranger: pause to fetch a part. IN_PROGRESS -> PAUSED_PARTS. */
  async requestPause(workerId: string, jobId: string, input: RequestPauseInput) {
    const job = await this.workerJob(workerId, jobId);
    if (job.status !== 'IN_PROGRESS')
      throw conflict('You can only pause a job that is in progress.', { code: 'NOT_IN_PROGRESS' });
    const cfg = await this.fee.get();
    if (job.pausedExtensionCount >= cfg.max_parts_extensions) {
      throw conflict(`This job has already been paused ${cfg.max_parts_extensions} times.`, {
        code: 'EXTENSION_CAP_REACHED',
      });
    }
    await this.prisma.$transaction((tx) =>
      this.transitions.move(tx, {
        jobId,
        from: 'IN_PROGRESS',
        to: 'PAUSED_PARTS',
        actor: 'WORKER',
        actorUserId: workerId,
        data: {
          pausedAt: new Date(),
          pausedReason: input.reason,
          pausedReturnBy: new Date(input.expectedReturnAt),
          pausedExtensionCount: job.pausedExtensionCount + 1,
        },
      }),
    );
    await this.transitions.notify(jobId);
    return this.view.build(jobId, workerId);
  }

  /** Ranger: back with the part, resume work. PAUSED_PARTS -> IN_PROGRESS. */
  async resume(workerId: string, jobId: string) {
    const job = await this.workerJob(workerId, jobId);
    if (job.status !== 'PAUSED_PARTS')
      throw conflict('This job is not paused.', { code: 'NOT_PAUSED' });
    await this.prisma.$transaction((tx) =>
      this.transitions.move(tx, {
        jobId,
        from: 'PAUSED_PARTS',
        to: 'IN_PROGRESS',
        actor: 'WORKER',
        actorUserId: workerId,
      }),
    );
    await this.transitions.notify(jobId);
    return this.view.build(jobId, workerId);
  }

  /** Customer: decline to keep waiting. PAUSED_PARTS -> CANCELLED. Charges the visit fee once;
   * a settled amount for work already done before the pause is deferred (see docs/DECISIONS.md). */
  async rejectExtension(customerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    if (job.status !== 'PAUSED_PARTS')
      throw conflict('This job is not paused.', { code: 'NOT_PAUSED' });
    const distanceM = await travelledMeters(this.prisma, jobId);
    const visitFeePaise = await this.fee.visitFeePaise(distanceM);
    await this.prisma.$transaction((tx) =>
      this.transitions.move(tx, {
        jobId,
        from: 'PAUSED_PARTS',
        to: 'CANCELLED',
        actor: 'CUSTOMER',
        actorUserId: customerId,
        data: { visitFeePaise, visitFeeChargedAt: new Date(), closeReason: 'EXTENSION_REJECTED' },
      }),
    );
    await this.transitions.notify(jobId);
    return this.view.build(jobId, customerId);
  }

  /** Ranger: the part genuinely cannot be sourced. PAUSED_PARTS -> CANCELLED, no reliability
   * penalty (nothing yet reads WorkerProfile.reliabilityScore — see docs/DECISIONS.md), visit
   * fee still charged since the customer was visited and diagnosed. */
  async partsUnavailable(workerId: string, jobId: string) {
    const job = await this.workerJob(workerId, jobId);
    if (job.status !== 'PAUSED_PARTS')
      throw conflict('This job is not paused.', { code: 'NOT_PAUSED' });
    const distanceM = await travelledMeters(this.prisma, jobId);
    const visitFeePaise = await this.fee.visitFeePaise(distanceM);
    await this.prisma.$transaction((tx) =>
      this.transitions.move(tx, {
        jobId,
        from: 'PAUSED_PARTS',
        to: 'CANCELLED',
        actor: 'WORKER',
        actorUserId: workerId,
        data: { visitFeePaise, visitFeeChargedAt: new Date(), closeReason: 'PARTS_UNAVAILABLE' },
      }),
    );
    await this.transitions.notify(jobId);
    return this.view.build(jobId, workerId);
  }
}
