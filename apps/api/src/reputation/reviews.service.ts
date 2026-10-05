import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decodeCursor, toPage } from '@haggler/shared';
import { conflict, notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { ReputationService } from './reputation.service';

const firstName = (fullName: string | null): string | null =>
  fullName ? (fullName.trim().split(/\s+/)[0] ?? null) : null;

/**
 * Reviews (Phase 4): the customer can rate the Ranger, and the Ranger can rate the customer,
 * independently, each exactly once per job, only once the job is CONFIRMED_BY_CUSTOMER — the one
 * state that means the job genuinely happened and both sides agree it did. Money never enters
 * here (D-037): a review is a trust signal, not a payment event.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reputation: ReputationService,
  ) {}

  private async job(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || (job.customerId !== userId && job.workerId !== userId))
      throw notFound('Job not found');
    return job;
  }

  async submit(userId: string, jobId: string, input: { rating: number; comment?: string | null }) {
    const job = await this.job(userId, jobId);
    if (job.status !== 'CONFIRMED_BY_CUSTOMER')
      throw conflict('You can review once the job is confirmed complete.', {
        code: 'NOT_REVIEWABLE',
      });
    const raterRole = job.customerId === userId ? 'CUSTOMER' : 'WORKER';
    const revieweeId = raterRole === 'CUSTOMER' ? (job.workerId as string) : job.customerId;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.review.create({
          data: {
            jobId,
            raterId: userId,
            revieweeId,
            raterRole,
            rating: input.rating,
            comment: input.comment ?? null,
          },
        });
        if (raterRole === 'CUSTOMER') {
          await tx.workerStats.upsert({
            where: { workerUserId: revieweeId },
            update: { ratingSum: { increment: input.rating }, ratingCount: { increment: 1 } },
            create: { workerUserId: revieweeId, ratingSum: input.rating, ratingCount: 1 },
          });
          await this.reputation.recomputeWorkerLeague(tx, revieweeId);
        } else {
          await tx.customerStats.upsert({
            where: { customerUserId: revieweeId },
            update: { ratingSum: { increment: input.rating }, ratingCount: { increment: 1 } },
            create: { customerUserId: revieweeId, ratingSum: input.rating, ratingCount: 1 },
          });
          await this.reputation.recomputeCustomerLeague(tx, revieweeId); // D-077
        }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw conflict('You already reviewed this job.', { code: 'ALREADY_REVIEWED' });
      throw err;
    }
    return this.forJob(userId, jobId);
  }

  /** Both parties can see both reviews once either exists (nothing to hide: they already know
   * each other's name from the job itself). Also tells the viewer whether they still can/did review. */
  async forJob(userId: string, jobId: string) {
    const job = await this.job(userId, jobId);
    const rows = await this.prisma.review.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
    const myRole = job.customerId === userId ? 'CUSTOMER' : 'WORKER';
    // "submitted" reflects the true state (a hidden review still blocks a second submission via
    // the unique constraint) even though a moderated review's content is no longer shown below.
    const mine = rows.find((r) => r.raterRole === myRole);
    return {
      canReview: job.status === 'CONFIRMED_BY_CUSTOMER' && !mine,
      submitted: !!mine,
      reviews: rows
        .filter((r) => !r.hiddenAt)
        .map((r) => ({
          id: r.id,
          raterRole: r.raterRole,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt.toISOString(),
        })),
    };
  }

  /** A Ranger's public review history (only customer -> Ranger reviews; a Ranger's opinion of a
   * customer is never shown to other customers). Newest first, cursor-paginated. */
  async forWorker(workerId: string, cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after = c
      ? {
          OR: [
            { createdAt: { lt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.review.findMany({
      where: {
        AND: [{ revieweeId: workerId, raterRole: 'CUSTOMER' as const, hiddenAt: null }, after],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { job: { select: { customerId: true } } },
    });
    const customers = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.job.customerId) } },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(customers.map((u) => [u.id, firstName(u.fullName)]));
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        customerFirstName: nameById.get(r.job.customerId) ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }
}
