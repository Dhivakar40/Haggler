import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { type BadgeThreshold, DEFAULT_BADGE_THRESHOLDS, isValidThresholds } from './badge-tier';

const CONFIG_KEY = 'badge_tier_thresholds';

/** Reads the badge tier ladder from system_config (ops-tunable without a deploy), same caching
 * pattern as MarketplaceConfig. Falls back to the built-in defaults if unset or malformed. */
@Injectable()
export class ReputationConfig {
  private cache: { at: number; value: readonly BadgeThreshold[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async badgeThresholds(): Promise<readonly BadgeThreshold[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < 15_000) return this.cache.value;
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    const value = isValidThresholds(row?.value) ? row.value : DEFAULT_BADGE_THRESHOLDS;
    this.cache = { at: now, value };
    return value;
  }

  refresh(): void {
    this.cache = null;
  }
}
