import { Injectable } from '@nestjs/common';
import type { LeagueTierName, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { LEAGUE_ORDER, computeLeagueTier, leagueProgress } from './league-tier';
import { ReputationConfig } from './reputation-config.service';

export interface LeagueStatusDto {
  league: LeagueTierName;
  nextLeague: LeagueTierName | null;
  progress: number;
  jobsCompleted: number;
  ratingAvg: number | null;
  ratingCount: number;
  cancellationRate: number;
  /** The full ladder, lowest to highest, so a Ranger can see what's coming (Part D). */
  ladder: { tier: LeagueTierName; reached: boolean }[];
}

/**
 * One-time token bonus paid by the app to the Ranger on reaching a new league (D-076), keyed by
 * the league being entered. WOOD is the floor (never entered by promotion) so it is not a key.
 * Proposed amounts, not final — escalating to reward sustained excellence, at roughly ₹15/token
 * (packages/shared's seeded bundles) this tops out around ₹150 for LEGENDARY. Adjust freely.
 */
export const LEAGUE_UP_BONUS_TOKENS: Partial<Record<LeagueTierName, number>> = {
  STONE: 1,
  COPPER: 1,
  BRONZE: 2,
  SILVER: 2,
  GOLD: 3,
  PLATINUM: 4,
  DIAMOND: 6,
  LEGENDARY: 10,
};

export interface LeagueUpResult {
  from: LeagueTierName;
  to: LeagueTierName;
  bonusTokens: number;
}

/** Recomputes a Ranger's league. Called after anything that could move it: a new job completion
 * (lifecycle.service.ts's confirm()/cancel()/reportNoShow()) or a new review (reviews.service.ts).
 * Returns the promotion that happened, if any — Part F (sub-phase 4) surfaces this as the
 * league-up celebration popup; this phase only computes and pays it. */
@Injectable()
export class ReputationService {
  constructor(
    private readonly cfg: ReputationConfig,
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  /** What a Ranger sees on their league screen (Part D): current league, progress toward the
   * next one, and the full ordered ladder. A Ranger with no WorkerStats row yet (never completed
   * a job) reads as WOOD with zero everything — same default a real row would have. */
  async getLeagueStatus(workerId: string): Promise<LeagueStatusDto> {
    const stats = await this.prisma.workerStats.findUnique({ where: { workerUserId: workerId } });
    const thresholds = await this.cfg.leagueThresholds();
    const jobsCompleted = stats?.jobsCompleted ?? 0;
    const ratingSum = stats?.ratingSum ?? 0;
    const ratingCount = stats?.ratingCount ?? 0;
    const jobsCancelledByWorker = stats?.jobsCancelledByWorker ?? 0;
    const jobsDisputed = stats?.jobsDisputed ?? 0;

    const { current, next, progress } = leagueProgress(
      jobsCompleted,
      ratingSum,
      ratingCount,
      jobsCancelledByWorker,
      jobsDisputed,
      thresholds,
    );
    const currentIdx = LEAGUE_ORDER.indexOf(current);
    return {
      league: current,
      nextLeague: next,
      progress,
      jobsCompleted,
      ratingAvg: ratingCount > 0 ? ratingSum / ratingCount : null,
      ratingCount,
      cancellationRate: jobsCompleted > 0 ? jobsCancelledByWorker / jobsCompleted : 0,
      ladder: LEAGUE_ORDER.map((tier, i) => ({ tier, reached: i <= currentIdx })),
    };
  }

  async recomputeWorkerLeague(
    tx: Prisma.TransactionClient,
    workerId: string,
  ): Promise<LeagueUpResult | null> {
    const stats = await tx.workerStats.findUnique({ where: { workerUserId: workerId } });
    if (!stats) return null;
    const thresholds = await this.cfg.leagueThresholds();
    const league = computeLeagueTier(
      stats.jobsCompleted,
      stats.ratingSum,
      stats.ratingCount,
      stats.jobsCancelledByWorker,
      stats.jobsDisputed,
      thresholds,
    );
    if (league === stats.league) return null;
    await tx.workerStats.update({ where: { workerUserId: workerId }, data: { league } });

    const promoted = LEAGUE_ORDER.indexOf(league) > LEAGUE_ORDER.indexOf(stats.league);
    if (!promoted) return null; // a league can also drop (e.g. a cancellation rate regressed it); no bonus then

    const bonusTokens = LEAGUE_UP_BONUS_TOKENS[league] ?? 0;
    if (bonusTokens > 0)
      await this.wallet.grantLeagueBonus(
        tx,
        workerId,
        bonusTokens,
        `Reached ${league} league`,
      );
    return { from: stats.league, to: league, bonusTokens };
  }
}
