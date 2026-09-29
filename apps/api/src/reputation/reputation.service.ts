import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { computeBadgeTier } from './badge-tier';
import { ReputationConfig } from './reputation-config.service';

/** Recomputes a Ranger's badge tier. Called after anything that could move it: a new job
 * completion (lifecycle.service.ts's confirm()) or a new review (reviews.service.ts). */
@Injectable()
export class ReputationService {
  constructor(private readonly cfg: ReputationConfig) {}

  async recomputeWorkerBadge(tx: Prisma.TransactionClient, workerId: string): Promise<void> {
    const stats = await tx.workerStats.findUnique({ where: { workerUserId: workerId } });
    if (!stats) return;
    const thresholds = await this.cfg.badgeThresholds();
    const tier = computeBadgeTier(
      stats.jobsCompleted,
      stats.ratingSum,
      stats.ratingCount,
      thresholds,
    );
    if (tier !== stats.badgeTier)
      await tx.workerStats.update({ where: { workerUserId: workerId }, data: { badgeTier: tier } });
  }
}
