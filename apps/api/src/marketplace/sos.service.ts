import { Injectable } from '@nestjs/common';
import { ACTIVE_JOB_STATES, type TriggerSosInput } from '@haggler/shared';
import { notFound, unprocessable } from '../common/http-errors';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountHoldService } from '../users/account-hold.service';
import { JobViewService } from './job-view.service';

/**
 * D-080 (Sub-phase C): either party raises an SOS during an active job. The other party is
 * pushed at once; a DISPUTE_AGENT/SUPER_ADMIN sees it in the admin review queue
 * (admin-sos.service.ts). Reaching the triggering party's own emergency contacts is a client-side
 * share (the mobile app composes the message from its own contacts list and the job's live
 * location), the same pattern already used for TrustedShare's live-trip link — this codebase has
 * no SMS adapter to send on a user's behalf.
 *
 * D-093 (Sub-phase J): an SOS also puts the OTHER party on TEMPORARY_HOLD pending admin review,
 * same as a theft/harassment incident report — the master prompt groups SOS with those two as an
 * automatic-hold trigger. Worth being honest about the trade-off this makes: an SOS is not
 * always about the other person (it could be a medical emergency, an accident, nothing to do
 * with them at all), so this errs toward protecting the other party at the cost of occasionally
 * holding someone's account over an unrelated emergency. The 24h admin-review SLA this is meant
 * to pair with is what keeps that error short-lived, not a judgment that every SOS is credible.
 */
@Injectable()
export class SosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly view: JobViewService,
    private readonly hold: AccountHoldService,
  ) {}

  async trigger(userId: string, jobId: string, input: TriggerSosInput) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || (job.customerId !== userId && job.workerId !== userId))
      throw notFound('Job not found');
    if (!(ACTIVE_JOB_STATES as readonly string[]).includes(job.status))
      throw unprocessable('This job is not active.', { code: 'JOB_NOT_ACTIVE' });

    const role = job.customerId === userId ? 'CUSTOMER' : 'WORKER';
    await this.prisma.sosAlert.create({
      data: {
        jobId,
        triggeredBy: userId,
        role,
        latitude: input.latitude,
        longitude: input.longitude,
        note: input.note,
      },
    });

    const otherPartyId = role === 'CUSTOMER' ? job.workerId : job.customerId;
    if (otherPartyId) {
      await this.notifications.notify(otherPartyId, {
        title: 'Safety alert',
        body: 'The other person on this job has raised a safety alert.',
        data: { jobId, type: 'sos' },
      });
      await this.hold.holdForSafety(otherPartyId, 'SOS', { type: 'job', id: jobId });
    }
    return this.view.build(jobId, userId);
  }
}
