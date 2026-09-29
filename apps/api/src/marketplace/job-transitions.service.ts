import { Injectable } from '@nestjs/common';
import type { JobStatus, Prisma } from '@prisma/client';
import { SOCKET_EVENTS } from '@haggler/shared';
import { conflict } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { type Actor, assertTransition } from './job-state';

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
    if (input.to === 'CONFIRMED_BY_CUSTOMER') await this.wallet.consume(tx, input.jobId);
    else if (RELEASES_TOKEN.includes(input.to)) await this.wallet.release(tx, input.jobId);
  }

  /** Tell both parties the job changed; their apps re-read it (payload is intentionally tiny). */
  async notify(jobId: string, extra: Record<string, unknown> = {}): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { customerId: true, workerId: true, status: true, requestId: true },
    });
    if (!job) return;
    const payload = { jobId, requestId: job.requestId, status: job.status, ...extra };
    this.realtime.emitToUsers(
      [job.customerId, ...(job.workerId ? [job.workerId] : [])],
      SOCKET_EVENTS.jobUpdated,
      payload,
    );
  }
}
