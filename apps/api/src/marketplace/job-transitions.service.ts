import { Injectable } from '@nestjs/common';
import type { JobStatus, Prisma } from '@prisma/client';
import { SOCKET_EVENTS } from '@haggler/shared';
import { diagMark } from '../common/diag-timing'; // TEMPORARY — D-078
import { conflict } from '../common/http-errors';
import type { PushMessage } from '../adapters/push/push.provider';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { type Actor, assertTransition } from './job-state';

/**
 * Push copy for statuses where a plain-language nudge is worth an interruption. Statuses not
 * listed here (NEGOTIATING/AGREED go through offers.service's own offerUpdated event; MATCHED is
 * pushed directly by matching.service so the wording can name the Ranger) send no push from here.
 * Not yet localised to the recipient's language (i18n keys live client-side only) — see D-050.
 */
const STATUS_PUSH: Partial<Record<JobStatus, { customer?: PushMessage; worker?: PushMessage }>> = {
  EN_ROUTE: {
    customer: { title: 'Ranger on the way', body: 'Your Ranger is heading to you now.' },
  },
  ARRIVED: { customer: { title: 'Ranger has arrived', body: 'Your Ranger is at your location.' } },
  CONFIRMED_BY_CUSTOMER: {
    worker: { title: 'Job confirmed', body: 'The customer confirmed the job is complete.' },
  },
  CANCELLED: {
    worker: { title: 'Job cancelled', body: 'This job was cancelled.' },
  },
  NO_SHOW_WORKER: {
    customer: { title: 'Ranger did not show up', body: 'This job was marked as a no-show.' },
  },
  NO_SHOW_CUSTOMER: {
    worker: { title: 'Customer did not show up', body: 'This job was marked as a no-show.' },
  },
};

/** Terminal states that never confirm: the customer's held token goes back to their balance (D-037). */
const RELEASES_TOKEN: JobStatus[] = ['CANCELLED', 'NO_SHOW_WORKER', 'NO_SHOW_CUSTOMER'];

/**
 * The only code that changes `jobs.status`. It (1) checks the state machine, (2) changes the row
 * ONLY IF it is still in the state we read (optimistic concurrency), (3) appends the change to
 * job_events, and (4) settles the customer's held wallet token if this transition is CONFIRMED or a
 * terminal non-confirm — all in the caller's transaction. If two requests race (customer cancels
 * while the Ranger taps "en route"), one wins and the other gets a clean 409, never a corrupt state.
 */
@Injectable()
export class JobTransitions {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly wallet: WalletService,
  ) {}

  async move(
    tx: Prisma.TransactionClient,
    input: {
      jobId: string;
      from: JobStatus;
      to: JobStatus;
      actor: Actor;
      actorUserId?: string | null;
      data?: Prisma.JobUncheckedUpdateManyInput;
      meta?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    assertTransition(input.from, input.to, input.actor);
    const res = await tx.job.updateMany({
      where: { id: input.jobId, status: input.from },
      data: { ...(input.data ?? {}), status: input.to },
    });
    diagMark('move:after job.updateMany'); // TEMPORARY — D-078
    if (res.count !== 1)
      throw conflict('This job just changed. Refresh and try again.', { code: 'STALE_JOB' });
    await tx.jobEvent.create({
      data: {
        jobId: input.jobId,
        fromStatus: input.from,
        toStatus: input.to,
        actorUserId: input.actorUserId ?? null,
        meta: input.meta,
      },
    });
    diagMark('move:after jobEvent.create'); // TEMPORARY — D-078
    if (input.to === 'CONFIRMED_BY_CUSTOMER') await this.wallet.consume(tx, input.jobId);
    else if (RELEASES_TOKEN.includes(input.to)) await this.wallet.release(tx, input.jobId);
    diagMark('move:after wallet.consume/release'); // TEMPORARY — D-078
  }

  /** Tell both parties the job changed; their apps re-read it (payload is intentionally tiny). */
  async notify(jobId: string, extra: Record<string, unknown> = {}): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { customerId: true, workerId: true, status: true, requestId: true },
    });
    diagMark('notify:after job.findUnique'); // TEMPORARY — D-078
    if (!job) return;
    const payload = { jobId, requestId: job.requestId, status: job.status, ...extra };
    const push = STATUS_PUSH[job.status];
    this.realtime.emitToUser(job.customerId, SOCKET_EVENTS.jobUpdated, payload, push?.customer);
    if (job.workerId)
      this.realtime.emitToUser(job.workerId, SOCKET_EVENTS.jobUpdated, payload, push?.worker);
  }
}
