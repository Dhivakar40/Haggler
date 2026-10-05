import { Injectable } from '@nestjs/common';
import type { ClientLeagueTierName, LeagueTierName, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
  CLIENT_LEAGUE_ORDER,
  clientLeagueProgress,
  computeClientLeagueTier,
} from './client-league-tier';
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

export interface ClientLeagueStatusDto {
  league: ClientLeagueTierName;
  nextLeague: ClientLeagueTierName | null;
  progress: number;
  bookingsCompleted: number;
  ratingAvg: number | null;
  ratingCount: number;
  cancellationRate: number;
  /** The full ladder, lowest to highest, so a client can see what's coming (Part E). */
  ladder: { tier: ClientLeagueTierName; reached: boolean }[];
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

/**
 * Same mechanism for clients (D-077, Part E), approved amounts — see docs/DECISIONS.md. REGULAR
 * is deliberately excluded (0 tokens): with a 1-booking floor, rewarding it would let someone
 * finish two bookings and have the second effectively free.
 */
export const CLIENT_LEAGUE_UP_BONUS_TOKENS: Partial<Record<ClientLeagueTierName, number>> = {
  PREFERRED: 1,
  TRUSTED: 2,
  LOYAL: 2,
  ELITE: 3,
  CHAMPION: 4,
  PATRON: 6,
  LEGEND: 10,
};

export interface LeagueUpResult {
  from: LeagueTierName;
  to: LeagueTierName;
  bonusTokens: number;
}

export interface ClientLeagueUpResult {
  from: ClientLeagueTierName;
  to: ClientLeagueTierName;
  bonusTokens: number;
}

/** Recomputes a Ranger's or client's league. Called after anything that could move it: a new job
 * completion (lifecycle.service.ts's confirm()/cancel()/reportNoShow()) or a new review
 * (reviews.service.ts). Returns the promotion that happened, if any — Part F (sub-phase 4)
 * surfaces this as the league-up celebration popup; this phase only computes and pays it. */
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

  /** The client-league mirror of getLeagueStatus (Part E). */
  async getClientLeagueStatus(customerId: string): Promise<ClientLeagueStatusDto> {
    const stats = await this.prisma.customerStats.findUnique({
      where: { customerUserId: customerId },
    });
    const thresholds = await this.cfg.clientLeagueThresholds();
    const bookingsCompleted = stats?.bookingsCompleted ?? 0;
    const ratingSum = stats?.ratingSum ?? 0;
    const ratingCount = stats?.ratingCount ?? 0;
    const bookingsCancelledByCustomer = stats?.bookingsCancelledByCustomer ?? 0;

    const { current, next, progress } = clientLeagueProgress(
      bookingsCompleted,
      ratingSum,
      ratingCount,
      bookingsCancelledByCustomer,
      thresholds,
    );
    const currentIdx = CLIENT_LEAGUE_ORDER.indexOf(current);
    return {
      league: current,
      nextLeague: next,
      progress,
      bookingsCompleted,
      ratingAvg: ratingCount > 0 ? ratingSum / ratingCount : null,
      ratingCount,
      cancellationRate: bookingsCompleted > 0 ? bookingsCancelledByCustomer / bookingsCompleted : 0,
      ladder: CLIENT_LEAGUE_ORDER.map((tier, i) => ({ tier, reached: i <= currentIdx })),
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

    // D-077: the bonus is paid against the high-water mark (highestLeague), not the raw old-vs-new
    // league comparison — a drop (e.g. a cancellation-rate regression) followed by re-climbing back
    // to a league already recorded here must never pay the bonus a second time. `league` and
    // `highestLeague` (when it moves) are written in one round trip, not two — this runs inside
    // lifecycle.service.ts's confirm() transaction alongside several other queries, and a hosted
    // database's per-query latency makes every round trip saved here worth saving (D-074).
    const newRank = LEAGUE_ORDER.indexOf(league);
    const highestRank = LEAGUE_ORDER.indexOf(stats.highestLeague);
    const promoted = newRank > highestRank;
    await tx.workerStats.update({
      where: { workerUserId: workerId },
      data: { league, ...(promoted ? { highestLeague: league } : {}) },
    });
    if (!promoted) return null;

    const bonusTokens = LEAGUE_UP_BONUS_TOKENS[league] ?? 0;
    if (bonusTokens > 0)
      await this.wallet.grantLeagueBonus(tx, workerId, bonusTokens, `Reached ${league} league`);
    return { from: stats.league, to: league, bonusTokens };
  }

  /** The client-league mirror of recomputeWorkerLeague (Part E), same highest-league idempotency. */
  async recomputeCustomerLeague(
    tx: Prisma.TransactionClient,
    customerId: string,
  ): Promise<ClientLeagueUpResult | null> {
    const stats = await tx.customerStats.findUnique({ where: { customerUserId: customerId } });
    if (!stats) return null;
    const thresholds = await this.cfg.clientLeagueThresholds();
    const league = computeClientLeagueTier(
      stats.bookingsCompleted,
      stats.ratingSum,
      stats.ratingCount,
      stats.bookingsCancelledByCustomer,
      thresholds,
    );
    if (league === stats.league) return null;

    const newRank = CLIENT_LEAGUE_ORDER.indexOf(league);
    const highestRank = CLIENT_LEAGUE_ORDER.indexOf(stats.highestLeague);
    const promoted = newRank > highestRank;
    await tx.customerStats.update({
      where: { customerUserId: customerId },
      data: { league, ...(promoted ? { highestLeague: league } : {}) },
    });
    if (!promoted) return null;

    const bonusTokens = CLIENT_LEAGUE_UP_BONUS_TOKENS[league] ?? 0;
    if (bonusTokens > 0)
      await this.wallet.grantLeagueBonus(tx, customerId, bonusTokens, `Reached ${league} league`);
    return { from: stats.league, to: league, bonusTokens };
  }
}
