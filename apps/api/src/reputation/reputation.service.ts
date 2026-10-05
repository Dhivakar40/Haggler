import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
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
export class ReputationService implements OnModuleInit {
  private readonly logger = new Logger(ReputationService.name);
  private readonly pendingRecomputes = new Set<Promise<void>>();

  constructor(
    private readonly cfg: ReputationConfig,
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  /** D-078: confirm() defers the league recompute below (scheduleConfirmLeagueRecompute) to after
   * its own transaction commits, so a hosted database's per-query latency isn't paid synchronously
   * for work that doesn't change what confirm() returns to the caller. If the process restarts
   * between that commit and the deferred step running, the counter increment (jobsCompleted /
   * bookingsCompleted) is already durably saved — only the league/bonus recompute is missing — so
   * this sweep runs once at boot and fixes up exactly those rows: anything whose stored `league`
   * doesn't match what the stored counters actually compute to. No BullMQ, no new Job column: the
   * existing WorkerStats/CustomerStats rows are themselves the durable "is this done yet?" record. */
  async onModuleInit(): Promise<void> {
    try {
      await this.sweepStaleLeagues();
    } catch (err) {
      this.logger.error(err, 'startup league sweep failed; will retry on next boot');
    }
  }

  /** Bounded to rows touched in the last 24h: a confirm() whose deferred step never ran would have
   * updated its WorkerStats/CustomerStats row right before the process went down, so anything older
   * has certainly already been reconciled — no need to scan the whole table on every boot. */
  async sweepStaleLeagues(sinceMs = 24 * 3600 * 1000): Promise<{ worker: number; customer: number }> {
    const cutoff = new Date(Date.now() - sinceMs);
    const [thresholds, clientThresholds] = await Promise.all([
      this.cfg.leagueThresholds(),
      this.cfg.clientLeagueThresholds(),
    ]);

    const workerRows = await this.prisma.workerStats.findMany({
      where: { updatedAt: { gte: cutoff } },
    });
    let workerFixed = 0;
    for (const row of workerRows) {
      const computed = computeLeagueTier(
        row.jobsCompleted,
        row.ratingSum,
        row.ratingCount,
        row.jobsCancelledByWorker,
        row.jobsDisputed,
        thresholds,
      );
      if (computed !== row.league) {
        await this.prisma.$transaction((tx) => this.recomputeWorkerLeague(tx, row.workerUserId));
        workerFixed++;
      }
    }

    const customerRows = await this.prisma.customerStats.findMany({
      where: { updatedAt: { gte: cutoff } },
    });
    let customerFixed = 0;
    for (const row of customerRows) {
      const computed = computeClientLeagueTier(
        row.bookingsCompleted,
        row.ratingSum,
        row.ratingCount,
        row.bookingsCancelledByCustomer,
        clientThresholds,
      );
      if (computed !== row.league) {
        await this.prisma.$transaction((tx) =>
          this.recomputeCustomerLeague(tx, row.customerUserId),
        );
        customerFixed++;
      }
    }

    if (workerFixed || customerFixed)
      this.logger.warn(
        { workerFixed, customerFixed },
        'startup league sweep found and fixed stale rows (a deferred recompute did not finish before a restart)',
      );
    return { worker: workerFixed, customer: customerFixed };
  }

  /** D-078: confirm()'s replacement for calling recomputeWorkerLeague/recomputeCustomerLeague
   * synchronously inside its own transaction. Fires after that transaction has already committed,
   * so a slow recompute (and any league-up bonus grant) never adds to confirm()'s response time —
   * the counter increments it's based on are already durably saved by then. Idempotent via the
   * existing highestLeague high-water mark, so running it twice (a retry, or the startup sweep
   * above also catching this same job) never double-pays. Errors are logged, not thrown — there is
   * no caller left to hand them to — and the startup sweep is the safety net if one is ever missed. */
  scheduleConfirmLeagueRecompute(input: { workerId: string; customerId: string | null }): void {
    let settle: () => void = () => {};
    const task = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.pendingRecomputes.add(task);
    setImmediate(() => {
      this.prisma
        .$transaction(async (tx) => {
          await this.recomputeWorkerLeague(tx, input.workerId);
          if (input.customerId) await this.recomputeCustomerLeague(tx, input.customerId);
        })
        .catch((err) => {
          this.logger.error(
            err,
            `deferred league recompute failed for worker ${input.workerId}; the startup sweep will catch it on next boot`,
          );
        })
        .finally(() => {
          this.pendingRecomputes.delete(task);
          settle();
        });
    });
  }

  /** Test-only: waits for every scheduleConfirmLeagueRecompute() call still in flight. Production
   * code never needs this — the whole point of deferring is that nothing waits for it — but a test
   * asserting on league/wallet state right after confirm() needs a deterministic point to check at,
   * not a race against setImmediate (D-078). */
  async drainPendingRecomputes(): Promise<void> {
    while (this.pendingRecomputes.size > 0) await Promise.all(this.pendingRecomputes);
  }

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
