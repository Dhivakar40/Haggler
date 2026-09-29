import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { MarketplaceConfig } from './marketplace-config.service';
import { JobTransitions } from './job-transitions.service';
import { MatchingService } from './matching.service';
import { OffersService } from './offers.service';

/**
 * Timers for the marketplace: broadcast waves, offer expiry, timed-out broadcasts.
 * It polls Postgres (`next_wave_at <= now()`), so it works even when Redis is down, and it is safe
 * to run on several API servers at once because each wave is claimed atomically (see
 * MatchingService.advance). Tests call `tick()` directly for deterministic time.
 * (docs/DECISIONS.md D-030: DB polling for matching, BullMQ for maintenance jobs.)
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly matching: MatchingService,
    private readonly offers: OffersService,
    private readonly prisma: PrismaService,
    private readonly cfg: MarketplaceConfig,
    private readonly transitions: JobTransitions,
    private readonly env: EnvService,
  ) {}

  onModuleInit(): void {
    if (!this.env.env.SCHEDULER_ENABLED) return;
    this.timer = setInterval(() => void this.tick(), 2000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<{ waves: number; offers: number; cancelled: number }> {
    if (this.running) return { waves: 0, offers: 0, cancelled: 0 };
    this.running = true;
    try {
      const waves = await this.matching.processDue(now);
      const offers = await this.offers.sweep(now);
      const cancelled = await this.cancelStaleTimedOut(now);
      return { waves, offers, cancelled };
    } catch (err) {
      this.logger.error(`scheduler tick failed: ${String(err)}`);
      return { waves: 0, offers: 0, cancelled: 0 };
    } finally {
      this.running = false;
    }
  }

  /** A timed-out broadcast nobody re-broadcast or cancelled is closed after a while. */
  private async cancelStaleTimedOut(now: Date): Promise<number> {
    const cfg = await this.cfg.get();
    const cutoff = new Date(now.getTime() - cfg.timed_out_cancel_minutes * 60_000);
    const stale = await this.prisma.job.findMany({
      where: {
        status: 'BROADCASTING',
        workerId: null,
        nextWaveAt: null,
        currentWave: { gte: cfg.broadcast_radii_m.length },
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
    });
    let n = 0;
    for (const j of stale) {
      try {
        await this.prisma.$transaction((tx) =>
          this.transitions.move(tx, {
            jobId: j.id,
            from: 'BROADCASTING',
            to: 'CANCELLED',
            actor: 'SYSTEM',
            data: { cancelledAt: now, cancelledBy: 'SYSTEM', cancelReason: 'NO_RANGER_FOUND' },
          }),
        );
        await this.transitions.notify(j.id);
        n += 1;
      } catch {
        /* someone else moved it first */
      }
    }
    return n;
  }
}
