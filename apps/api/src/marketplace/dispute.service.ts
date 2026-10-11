import { Injectable } from '@nestjs/common';
import type { RaiseDisputeInput } from '@haggler/shared';
import { conflict, notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { JobTransitions } from './job-transitions.service';
import { JobViewService } from './job-view.service';

/**
 * D-080 (Sub-phase D): raises a job into JobStatus.DISPUTED — an edge the state machine has had
 * since D-076 with nothing to drive it. The job's own trail (JobEvent, photos, GPS, JobPayment)
 * is the evidence; resolving it (admin-disputes.service.ts) is the only other move this state
 * allows.
 *
 * job-state.ts's table actually permits DISPUTED from IN_PROGRESS and COMPLETED_BY_WORKER too,
 * not only CONFIRMED_BY_CUSTOMER — but this service deliberately only opens one here. Resolving
 * a dispute moves the job back out of DISPUTED via a bare JobTransitions.move() (see
 * admin-disputes.service.ts), which does NOT re-run lifecycle.service.ts's confirm() payment
 * settlement (crediting the Ranger's wallet, jobsCompleted). From CONFIRMED_BY_CUSTOMER that
 * settlement already happened once, so skipping it on the way back is correct; from an earlier
 * status it never happened at all, and resolving the dispute would need to trigger it — a case
 * this round doesn't build. Scoping down to "post-confirmation disputes only" avoids that gap
 * rather than shipping a double-credit (or never-credit) bug.
 */
@Injectable()
export class DisputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: JobTransitions,
    private readonly view: JobViewService,
  ) {}

  async raise(userId: string, jobId: string, input: RaiseDisputeInput) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || (job.customerId !== userId && job.workerId !== userId))
      throw notFound('Job not found');
    const role = job.customerId === userId ? 'CUSTOMER' : 'WORKER';
    if (job.status !== 'CONFIRMED_BY_CUSTOMER')
      throw conflict(`A job that is ${job.status} cannot be disputed yet.`, {
        code: 'INVALID_TRANSITION',
      });
    const open = await this.prisma.dispute.findFirst({ where: { jobId, status: 'OPEN' } });
    if (open) throw conflict('This job already has an open dispute.', { code: 'ALREADY_DISPUTED' });

    await this.prisma.$transaction(async (tx) => {
      await this.transitions.move(tx, {
        jobId,
        from: job.status,
        to: 'DISPUTED',
        actor: role,
        actorUserId: userId,
      });
      await tx.dispute.create({
        data: { jobId, raisedBy: userId, role, reason: input.reason },
      });
    });
    return this.view.build(jobId, userId);
  }
}
