import { Injectable } from '@nestjs/common';
import type { ProposePauseSettlementInput, RecordHandoverInput, RequestPauseInput } from '@haggler/shared';
import { conflict, notFound, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { FeeService } from './fee.service';
import { travelledMeters } from './geo';
import { JobTransitions } from './job-transitions.service';
import { JobViewService } from './job-view.service';

/**
 * D-087/D-092 (Sub-phase I): the Ranger pauses an in-progress job to go fetch a part.
 * `max_parts_extensions` caps how many times one job can be paused, `max_concurrent_paused_jobs_
 * per_worker` caps how many a Ranger can have open at once. Reminders at the end of the promised
 * window are a Scheduler tick (see scheduler.service.ts); the end-of-window choice is Wait
 * (acknowledgeWait, below) or Cancel (rejectExtension) — Rebook is not built (see
 * docs/DECISIONS.md D-092: safely cloning a request without a Postgres sandbox to verify it
 * against is a distinct, riskier piece of work). Reserved return-slot calendars and
 * reliability-score penalties on a missed slot are also not built — nothing yet defines what
 * WorkerProfile.reliabilityScore measures.
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
    // I4: a Ranger cannot have more than N jobs paused at once — a Ranger who pauses everything
    // to go "shopping" would otherwise never be reachable for any of them.
    const concurrentPaused = await this.prisma.job.count({
      where: { workerId, status: 'PAUSED_PARTS' },
    });
    if (concurrentPaused >= cfg.max_concurrent_paused_jobs_per_worker) {
      throw conflict(
        `You can only have ${cfg.max_concurrent_paused_jobs_per_worker} job(s) paused at once.`,
        { code: 'CONCURRENT_PAUSE_CAP_REACHED' },
      );
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
          // A fresh pause starts with no reminder sent yet and no carried-over settlement
          // proposal from a previous pause on the same job.
          pausedOverdueNotifiedAt: null,
          pauseSettlementPaise: null,
          pauseSettlementBillPhotoId: null,
          pauseSettlementProposedAt: null,
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

  /** Ranger: propose an amount for work already done before the pause (I2), shown to the
   * customer alongside the visit fee if they go on to reject the extension. Capped at the job's
   * already-agreed labour total — never a number either side typed in unconstrained. */
  async proposeSettlement(workerId: string, jobId: string, input: ProposePauseSettlementInput) {
    const job = await this.workerJob(workerId, jobId);
    if (job.status !== 'PAUSED_PARTS')
      throw conflict('This job is not paused.', { code: 'NOT_PAUSED' });
    const quote = job.acceptedQuoteId
      ? await this.prisma.jobQuote.findUnique({ where: { id: job.acceptedQuoteId } })
      : null;
    const cap = quote?.servicePaise ?? job.agreedPricePaise;
    if (cap != null && input.amountPaise > cap) {
      throw unprocessable(`The amount cannot be more than the agreed labour total (₹${cap / 100}).`, {
        code: 'ABOVE_AGREED_TOTAL',
      });
    }
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        pauseSettlementPaise: input.amountPaise,
        pauseSettlementBillPhotoId: input.billPhotoId ?? null,
        pauseSettlementProposedAt: new Date(),
      },
    });
    await this.transitions.notify(jobId);
    return this.view.build(jobId, workerId);
  }

  /** Customer: "I'll keep waiting" — acknowledges the overdue reminder without changing
   * anything else, so the Scheduler won't nag again until the (possibly later) return time
   * passes a second time. */
  async acknowledgeWait(customerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    if (job.status !== 'PAUSED_PARTS')
      throw conflict('This job is not paused.', { code: 'NOT_PAUSED' });
    await this.prisma.job.update({
      where: { id: jobId },
      data: { pausedOverdueNotifiedAt: null },
    });
    return this.view.build(jobId, customerId);
  }

  /** Ranger: record that a part was handed off-site (I5), e.g. taken to a workshop for repair. */
  async recordHandover(workerId: string, jobId: string, input: RecordHandoverInput) {
    const job = await this.workerJob(workerId, jobId);
    if (job.status !== 'PAUSED_PARTS')
      throw conflict('This job is not paused.', { code: 'NOT_PAUSED' });
    await this.prisma.itemHandover.create({
      data: {
        jobId,
        photoId: input.photoId,
        description: input.description,
        workshop: input.workshop,
        expectedReturnAt: new Date(input.expectedReturnAt),
      },
    });
    await this.transitions.notify(jobId);
    return this.view.build(jobId, workerId);
  }

  /** Customer: sign off that they agreed to a specific handover. */
  async signOffHandover(customerId: string, jobId: string, handoverId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    const handover = await this.prisma.itemHandover.findUnique({ where: { id: handoverId } });
    if (!handover || handover.jobId !== jobId) throw notFound('Handover record not found');
    if (!handover.customerSignedOffAt) {
      await this.prisma.itemHandover.update({
        where: { id: handoverId },
        data: { customerSignedOffAt: new Date() },
      });
    }
    await this.transitions.notify(jobId);
    return this.view.build(jobId, customerId);
  }

  /** Customer: decline to keep waiting (the "Cancel" choice of I3's Wait/Cancel/Rebook). PAUSED_
   * PARTS -> CANCELLED. Always charges the visit fee; additionally owes the Ranger's proposed
   * work-done-so-far amount (I2) if one was made — `job.pauseSettlementPaise` is left as the
   * JobDto already surfaces it, this just freezes the visit fee alongside it at closing time. */
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
