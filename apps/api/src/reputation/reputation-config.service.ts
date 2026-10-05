import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_LEAGUE_THRESHOLDS, isValidThresholds, type LeagueThreshold } from './league-tier';

const CONFIG_KEY = 'league_thresholds';

/** Reads the league ladder from system_config (ops-tunable without a deploy), same caching
 * pattern as MarketplaceConfig. Falls back to the built-in defaults if unset or malformed. */
@Injectable()
export class ReputationConfig {
  private cache: { at: number; value: readonly LeagueThreshold[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async leagueThresholds(): Promise<readonly LeagueThreshold[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < 15_000) return this.cache.value;
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    const value = isValidThresholds(row?.value) ? row.value : DEFAULT_LEAGUE_THRESHOLDS;
    this.cache = { at: now, value };
    return value;
  }

  refresh(): void {
    this.cache = null;
  }
}
