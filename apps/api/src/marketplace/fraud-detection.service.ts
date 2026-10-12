import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { FeeService } from './fee.service';

type Tx = Prisma.TransactionClient;

/**
 * D-093 (Sub-phase K1): league-bonus fraud signals. Every method here only ever reads Job rows
 * and writes a FraudReviewItem — nothing here changes a balance or a league. That happens
 * elsewhere, unconditionally, the same way it always has; an admin reviewing a flagged item
 * decides what (if anything) to do about it using the existing dispute/suspension tools.
 */
@Injectable()
export class FraudDetectionService {
  constructor(private readonly fee: FeeService) {}

  /** Called right where a worker league promotion is about to pay its one-time bonus
   * (ReputationService.recomputeWorkerLeague). Runs inside that same transaction so a flagged
   * item is recorded atomically with the promotion that triggered the check, never blocking or
   * delaying the bonus itself. */
  async checkWorkerPromotion(tx: Tx, workerId: string, league: string): Promise<void> {
    const cfg = await this.fee.get();
    const velocityCutoff = new Date(Date.now() - cfg.fraud_velocity_window_hours * 60 * 60 * 1000);
    const pairCutoff = new Date(Date.now() - cfg.fraud_repeat_pair_window_days * 24 * 60 * 60 * 1000);
    const lookbackStart = pairCutoff < velocityCutoff ? pairCutoff : velocityCutoff;

    const recentJobs = await tx.job.findMany({
      where: { workerId, status: 'CONFIRMED_BY_CUSTOMER', confirmedAt: { gte: lookbackStart } },
      select: { id: true, customerId: true, confirmedAt: true, agreedPricePaise: true },
    });

    const velocityJobs = recentJobs.filter((j) => j.confirmedAt && j.confirmedAt >= velocityCutoff);
    if (velocityJobs.length >= cfg.fraud_velocity_max_jobs) {
      await this.flag(tx, 'VELOCITY', workerId, null, {
        league,
        jobCount: velocityJobs.length,
        windowHours: cfg.fraud_velocity_window_hours,
      });
    }

    const pairJobs = recentJobs.filter((j) => j.confirmedAt && j.confirmedAt >= pairCutoff);
    const byCustomer = new Map<string, number>();
    for (const j of pairJobs) byCustomer.set(j.customerId, (byCustomer.get(j.customerId) ?? 0) + 1);
    for (const [customerId, count] of byCustomer) {
      if (count >= cfg.fraud_repeat_pair_max_count) {
        await this.flag(tx, 'REPEAT_PAIR', workerId, customerId, {
          league,
          jobCount: count,
          windowDays: cfg.fraud_repeat_pair_window_days,
        });
      }
    }

    if (pairJobs.length > 0) {
      const belowMin = pairJobs.filter(
        (j) => (j.agreedPricePaise ?? 0) < cfg.fraud_min_job_value_paise,
      ).length;
      if (belowMin / pairJobs.length > 0.5) {
        await this.flag(tx, 'LOW_VALUE', workerId, null, {
          league,
          belowMinCount: belowMin,
          totalCount: pairJobs.length,
          minPaise: cfg.fraud_min_job_value_paise,
        });
      }
    }
  }

  /** One open flag of the same kind per subject at a time — a worker who keeps tripping the
   * same signal on every promotion does not need a dozen duplicate rows in the queue. */
  private async flag(
    tx: Tx,
    kind: 'VELOCITY' | 'REPEAT_PAIR' | 'LOW_VALUE',
    subjectUserId: string,
    relatedUserId: string | null,
    detail: Record<string, unknown>,
  ): Promise<void> {
    const existing = await tx.fraudReviewItem.findFirst({
      where: { kind, subjectUserId, relatedUserId, status: { in: ['OPEN', 'REVIEWING'] } },
    });
    if (existing) return;
    await tx.fraudReviewItem.create({
      data: { kind, subjectUserId, relatedUserId, detail: detail as Prisma.InputJsonValue },
    });
  }
}
